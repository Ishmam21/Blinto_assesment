import os
from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/movie-lookup", tags=["Movie lookup"])


class SearchResult(BaseModel):
    tmdb_id: int
    title: str
    poster_url: str | None


class MovieDetails(BaseModel):
    release_date: date | None
    release_year: int | None
    runtime_minutes: int | None


def tmdb_get(path, params=None):
    token = os.getenv("TMDB_READ_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="TMDB lookup is unavailable. TMDB_READ_TOKEN is not configured.")
    try:
        response = httpx.get(
            f"https://api.themoviedb.org/3{path}",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=5.0,
        )
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Movie not found in TMDB.")
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object")
        return payload
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail="TMDB lookup is unavailable. Try again later.") from error


@router.get("/search")
def search_movies(q: Annotated[str, Query(min_length=1, max_length=200)]) -> list[SearchResult]:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="Search query cannot be blank.")
    payload = tmdb_get("/search/movie", {"query": query, "include_adult": "false"})
    try:
        results = []
        for movie in payload["results"]:
            poster = movie.get("poster_path")
            results.append(
                SearchResult(
                    tmdb_id=movie["id"],
                    title=movie["title"],
                    poster_url=f"https://image.tmdb.org/t/p/w342{poster}" if poster else None,
                )
            )
        return results
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=502, detail="TMDB returned an invalid search response.") from error


@router.get("/{tmdb_id}/details")
def movie_details(tmdb_id: Annotated[int, Path(gt=0)]) -> MovieDetails:
    payload = tmdb_get(f"/movie/{tmdb_id}")
    try:
        full_date = date.fromisoformat(payload.get("release_date") or "")
    except (TypeError, ValueError):
        full_date = None
    runtime = payload.get("runtime")
    return MovieDetails(
        release_date=full_date,
        release_year=full_date.year if full_date else None,
        runtime_minutes=runtime if type(runtime) is int and runtime > 0 else None,
    )
