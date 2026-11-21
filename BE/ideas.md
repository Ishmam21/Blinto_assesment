# Doomsday Ready project decisions

Use this file as the decision log for the Blinto assessment. Update it when Fahim asks to save a project decision. These decisions apply to the full app.

## Prerequisites and watch order

- Save direct prerequisite links. Use DFS to find all indirect prerequisites and detect cycles. Return each prerequisite once, after the movies it depends on, and omit the target.
- Build the watch order in rounds using a topological sort. Each round contains the movies whose prerequisites were completed in earlier rounds. Within a round, sort by release date from earliest to latest. Use the release year when only the year is available and place movies with no release information last in that round. Prerequisite order always takes priority.
- The prerequisite picker autocompletes from movies already saved in the app. Display titles and years and submit the selected movie IDs.
- While the user types or changes selections, show an explanation for candidates that would create a cycle or are already required through another selected movie. Check the whole proposed list so the order in which movies were picked does not affect validation.
- Let the user submit the form. FastAPI validates the final list and rejects an invalid save with HTTP `409`, a distinct error code, and an explanation. Keep the user's selections visible so they can fix the issue and submit again.

| Conflict | API error code | Example explanation |
| --- | --- | --- |
| One selected prerequisite already requires another selected prerequisite, directly or through multiple links | `REDUNDANT_PREREQUISITE` | The Avengers is already required through Civil War. Remove The Avengers from this list to save. |
| A proposed link would create a cycle, including a movie requiring itself | `CIRCULAR_DEPENDENCY` | Infinity War already requires The Avengers through Civil War. Adding it here would create a loop. |

Example: Civil War requires The Avengers. For Infinity War, selecting Civil War already includes The Avengers in the watch order. Submitting both as direct prerequisites fails. This applies whether Civil War or The Avengers was picked first. Cycle rejection is required by the assessment. Redundancy rejection is an additional project decision.

## Database design

- Use the local PostgreSQL database provided by Docker Compose. The movie feature uses `movies` and a `movie_prerequisites` join table. Each uses a regular single-column `id` primary key.
- Each prerequisite row stores `movie_id` and `prerequisite_id`. Both reference `movies.id`. Use FastAPI to deduplicate identical IDs in a submitted list. The join table uses neither a composite primary key nor a combined unique constraint.
- Store cinemas and their bundle sizes in `cinemas`. The booking feature calculates a quote.

## Add-movie autocomplete

- Use a separate search box for external movie lookup when adding a movie. Prerequisite autocomplete searches the app's saved movies.
- Always offer **Add manually**, whether the external search returns no results or shows a matching movie. Accept the user's title and manually entered details without requiring them to select a provider result.
- Titles are unique across all movies saved in the app, regardless of who added them or how they were entered. A matching title in the external catalog does not count as a duplicate. Enforce uniqueness in the database and return HTTP `409 MOVIE_TITLE_ALREADY_EXISTS` with an explanation such as “A movie named Avengers already exists in this app.” when a save conflicts.
- TMDB is the proposed provider. By default, external autocomplete displays and fills only the movie title and cover. The user enters the release date or year, runtime, and other fields manually.
- Provide an explicit **Autofill movie info** option for the selected movie. Only when the user chooses it may the app fetch and fill metadata such as the release date or year and runtime. These fields stay editable.
- External lookup and optional autofill never import or set prerequisites. The user sets prerequisites by selecting movies already saved in the app.
- Keep the provider token server-side and include the provider's required attribution if used.
