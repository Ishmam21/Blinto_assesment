from collections import defaultdict
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import Boolean, Date, Integer, Text, column, delete, insert, select, table, text, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from booking import exact_booking
from db import engine
from movie_graph import CycleError, GraphConflict, validate_prerequisites, watch_order
from movie_lookup import router as lookup_router
from schemas import (
    BookingQuote,
    Cinema,
    CinemaCreate,
    Movie,
    MovieCreate,
    MoviePatch,
    PrerequisiteProposal,
    PrerequisiteValidation,
    RewatchOrder,
)

app = FastAPI(title="Doomsday Ready API")
app.include_router(lookup_router)

# SQLAlchemy Core references to the existing tables.
movies = table(
    "movies",
    column("id", Integer),
    column("title", Text),
    column("release_year", Integer),
    column("release_date", Date),
    column("runtime_minutes", Integer),
    column("poster_url", Text),
    column("watched", Boolean),
)
links = table(
    "movie_prerequisites",
    column("id", Integer),
    column("movie_id", Integer),
    column("prerequisite_id", Integer),
)
cinemas = table(
    "cinemas", column("id", Integer), column("name", Text), column("bundle_sizes", ARRAY(Integer))
)


def conflict(code, message):
    return HTTPException(status_code=409, detail={"code": code, "message": message})


def title_conflict(title):
    return conflict("MOVIE_TITLE_ALREADY_EXISTS", f"A movie named {title} already exists in this app.")


def require_row(row, resource):
    if row is None:
        raise HTTPException(status_code=404, detail=f"{resource} not found.")
    return row


def read_movie_graph(connection):
    # One statement gives the movies and links from the same database snapshot.
    statement = (
        select(movies, links.c.prerequisite_id)
        .outerjoin(links, movies.c.id == links.c.movie_id)
        .order_by(movies.c.id, links.c.prerequisite_id)
    )
    saved = {}
    prerequisites = defaultdict(list)
    for row in connection.execute(statement).mappings():
        fields = dict(row)
        prerequisite_id = fields.pop("prerequisite_id")
        saved[row.id] = fields
        if prerequisite_id is not None:
            prerequisites[row.id].append(prerequisite_id)
    return saved, prerequisites


def movie_response(fields, prerequisites):
    return Movie(**fields, prerequisite_ids=sorted(set(prerequisites)))


def lock_prerequisite_writes(connection):
    # Held until commit or rollback. Readers can still read the last committed graph.
    connection.execute(text("LOCK TABLE movie_prerequisites IN SHARE ROW EXCLUSIVE MODE"))


def check_proposal(connection, movie_id, prerequisite_ids):
    proposed = sorted(set(prerequisite_ids))
    saved, graph = read_movie_graph(connection)
    if movie_id is not None:
        require_row(saved.get(movie_id), "Movie")
        # The proposed list replaces these outgoing links.
        graph.pop(movie_id, None)
    unknown = sorted(set(proposed) - saved.keys())
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown prerequisite IDs: {unknown}.")
    try:
        validate_prerequisites(movie_id, proposed, graph, {key: value["title"] for key, value in saved.items()})
    except GraphConflict as error:
        raise conflict(error.code, str(error)) from error
    except CycleError as error:
        raise saved_cycle_error(error, saved) from error
    return proposed


def saved_cycle_error(error, saved):
    path = " → ".join(saved[node]["title"] for node in error.path)
    return conflict("CIRCULAR_DEPENDENCY", f"The saved prerequisites contain a loop: {path}.")


def insert_links(connection, movie_id, prerequisite_ids):
    if prerequisite_ids:
        connection.execute(
            insert(links),
            [{"movie_id": movie_id, "prerequisite_id": item} for item in prerequisite_ids],
        )


@app.post("/api/movies/validate-prerequisites")
def validate_proposal(body: PrerequisiteProposal) -> PrerequisiteValidation:
    with engine.connect() as connection:
        check_proposal(connection, body.movie_id, body.prerequisite_ids)
    return PrerequisiteValidation(valid=True)


@app.post("/api/movies", status_code=201)
def create_movie(body: MovieCreate) -> Movie:
    with engine.begin() as connection:
        lock_prerequisite_writes(connection)
        proposed = check_proposal(connection, None, body.prerequisite_ids)
        statement = (
            pg_insert(movies)
            .values(**body.model_dump(exclude={"prerequisite_ids"}))
            .on_conflict_do_nothing(index_elements=[movies.c.title])
            .returning(*movies.c)
        )
        created = connection.execute(statement).mappings().one_or_none()
        if created is None:
            raise title_conflict(body.title)
        insert_links(connection, created.id, proposed)
        return movie_response(created, proposed)


@app.get("/api/movies")
def list_movies() -> list[Movie]:
    with engine.connect() as connection:
        saved, graph = read_movie_graph(connection)
    return [movie_response(movie, graph.get(movie_id, ())) for movie_id, movie in saved.items()]


@app.patch("/api/movies/{id}")
def patch_movie(id: int, body: MoviePatch) -> Movie:
    changes = body.model_dump(exclude_unset=True, exclude={"prerequisite_ids"})
    with engine.begin() as connection:
        if body.prerequisite_ids is not None:
            lock_prerequisite_writes(connection)
        statement = select(movies).where(movies.c.id == id).with_for_update()
        movie = require_row(connection.execute(statement).mappings().one_or_none(), "Movie")

        if "release_date" in changes or "release_year" in changes:
            release_date = changes.get("release_date", movie.release_date)
            release_year = changes.get("release_year", movie.release_year)
            if release_date is not None and release_date.year != release_year:
                raise HTTPException(status_code=422, detail="release_date must agree with release_year.")

        if body.prerequisite_ids is not None:
            proposed = check_proposal(connection, id, body.prerequisite_ids)
        else:
            proposed = connection.scalars(select(links.c.prerequisite_id).where(links.c.movie_id == id)).all()

        if changes:
            statement = update(movies).where(movies.c.id == id).values(**changes).returning(*movies.c)
            try:
                movie = connection.execute(statement).mappings().one()
            except IntegrityError as error:
                # Title is the only unique column this update can change.
                if "title" in changes and getattr(error.orig, "sqlstate", None) == "23505":
                    raise title_conflict(changes["title"]) from error
                raise

        if body.prerequisite_ids is not None:
            connection.execute(delete(links).where(links.c.movie_id == id))
            insert_links(connection, id, proposed)
        return movie_response(movie, proposed)


@app.get("/api/movies/{id}/rewatch-order")
def rewatch_order(id: int) -> RewatchOrder:
    with engine.connect() as connection:
        saved, graph = read_movie_graph(connection)
    require_row(saved.get(id), "Movie")
    try:
        order = watch_order(id, graph, saved)
    except CycleError as error:
        raise saved_cycle_error(error, saved) from error
    ordered_movies = [movie_response(saved[movie_id], graph.get(movie_id, ())) for movie_id in order]
    return RewatchOrder(
        movies=ordered_movies,
        watched_count=sum(movie.watched for movie in ordered_movies),
        total_prerequisite_count=len(ordered_movies),
        unwatched_runtime_minutes=sum(movie.runtime_minutes for movie in ordered_movies if not movie.watched),
    )


@app.post("/api/cinemas", status_code=201)
def create_cinema(body: CinemaCreate) -> Cinema:
    with engine.begin() as connection:
        statement = (
            pg_insert(cinemas)
            .values(**body.model_dump())
            .on_conflict_do_nothing(index_elements=[cinemas.c.name])
            .returning(*cinemas.c)
        )
        created = connection.execute(statement).mappings().one_or_none()
        if created is None:
            raise conflict("CINEMA_NAME_ALREADY_EXISTS", f"A cinema named {body.name} already exists.")
        return Cinema(**created)


@app.get("/api/cinemas")
def list_cinemas() -> list[Cinema]:
    with engine.connect() as connection:
        return [
            Cinema(**row)
            for row in connection.execute(select(cinemas).order_by(cinemas.c.id)).mappings()
        ]


@app.get("/api/cinemas/{id}/booking")
def booking_quote(id: int, group_size: Annotated[int, Query(alias="groupSize", ge=1, le=10_000)]) -> BookingQuote:
    with engine.connect() as connection:
        statement = select(cinemas).where(cinemas.c.id == id)
        cinema = require_row(connection.execute(statement).mappings().one_or_none(), "Cinema")
    count, quantities = exact_booking(cinema.bundle_sizes, group_size)
    return BookingQuote(possible=count is not None, minimum_bundle_count=count, bundle_quantities=quantities)
