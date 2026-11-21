from datetime import date
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
MovieId = Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]
Year = Annotated[int, Field(strict=True, ge=-2_147_483_648, le=2_147_483_647)]
Runtime = Annotated[int, Field(strict=True, ge=1, le=300)]
BundleSize = Annotated[int, Field(strict=True, ge=1, le=500)]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MovieCreate(RequestModel):
    title: Name
    release_year: Year
    release_date: date | None = None
    runtime_minutes: Runtime
    poster_url: str | None = None
    watched: bool = False
    prerequisite_ids: list[MovieId] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_release_date(self):
        if self.release_date is not None and self.release_date.year != self.release_year:
            raise ValueError("release_date must agree with release_year")
        return self


class MoviePatch(RequestModel):
    title: Name | None = None
    release_year: Year | None = None
    release_date: date | None = None
    runtime_minutes: Runtime | None = None
    poster_url: str | None = None
    watched: bool | None = None
    prerequisite_ids: list[MovieId] | None = None

    @field_validator("title", "release_year", "runtime_minutes", "watched", "prerequisite_ids")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("Field cannot be null")
        return value


class Movie(BaseModel):
    id: int
    title: str
    release_year: int
    release_date: date | None
    runtime_minutes: int
    poster_url: str | None
    watched: bool
    prerequisite_ids: list[int]


class PrerequisiteProposal(RequestModel):
    movie_id: MovieId | None = None
    prerequisite_ids: list[MovieId]


class PrerequisiteValidation(BaseModel):
    valid: bool


class RewatchOrder(BaseModel):
    movies: list[Movie]
    watched_count: int
    total_prerequisite_count: int
    unwatched_runtime_minutes: int


class CinemaCreate(RequestModel):
    name: Name
    bundle_sizes: Annotated[list[BundleSize], Field(min_length=1, max_length=10)]

    @field_validator("bundle_sizes")
    @classmethod
    def distinct_sizes(cls, sizes):
        if len(set(sizes)) != len(sizes):
            raise ValueError("Bundle sizes must be distinct")
        return sizes


class Cinema(BaseModel):
    id: int
    name: str
    bundle_sizes: list[int]


class BookingQuote(BaseModel):
    possible: bool
    minimum_bundle_count: int | None
    bundle_quantities: dict[int, int]
