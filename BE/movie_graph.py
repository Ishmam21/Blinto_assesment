"""Prerequisite traversal and watch order, independent of the API and database."""


class GraphConflict(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class CycleError(ValueError):
    def __init__(self, path):
        self.path = path


def prerequisite_dfs(target, prerequisites):
    """Return reachable prerequisites in DFS order and record paths to them."""
    order = []
    path = []
    visiting = set()
    finished = set()
    parent = {}

    # Keep the active path and postorder from the demo. Use explicit frames so
    # long chains do not depend on Python's recursion limit.
    def visit(movie):
        visiting.add(movie)
        path.append(movie)
        return iter(prerequisites.get(movie, ()))

    frames = [visit(target)]
    while frames:
        movie = path[-1]
        prerequisite = next(frames[-1], None)
        if prerequisite is None:
            frames.pop()
            path.pop()
            visiting.remove(movie)
            finished.add(movie)
            order.append(movie)
        elif prerequisite in visiting:
            raise CycleError(path[path.index(prerequisite):] + [prerequisite])
        elif prerequisite not in finished:
            parent[prerequisite] = movie
            frames.append(visit(prerequisite))

    return order[:-1], parent


def validate_prerequisites(movie_id, proposed, prerequisites, titles):
    for selected in proposed:
        if selected == movie_id:
            raise GraphConflict(
                "CIRCULAR_DEPENDENCY", f"{titles[selected]} cannot require itself."
            )

    traversals = {}
    for selected in proposed:
        reachable, parent = prerequisite_dfs(selected, prerequisites)
        if movie_id in parent:
            path = [movie_id]
            while path[-1] != selected:
                path.append(parent[path[-1]])
            explanation = " → ".join(titles[node] for node in reversed(path))
            raise GraphConflict(
                "CIRCULAR_DEPENDENCY",
                f"Adding {titles[selected]} would create a loop. Existing path: {explanation}.",
            )
        traversals[selected] = set(reachable)

    for through in proposed:
        for selected in proposed:
            if selected in traversals[through]:
                raise GraphConflict(
                    "REDUNDANT_PREREQUISITE",
                    f"{titles[selected]} is already required through {titles[through]}. "
                    f"Remove {titles[selected]} from this list to save.",
                )


def watch_order(target, prerequisites, movies):
    reachable, _ = prerequisite_dfs(target, prerequisites)
    dependents = {movie_id: [] for movie_id in reachable}
    remaining = {}
    for movie_id in reachable:
        dependencies = set(prerequisites.get(movie_id, ()))
        remaining[movie_id] = len(dependencies)
        for dependency in dependencies:
            dependents[dependency].append(movie_id)

    def release_key(movie_id):
        movie = movies[movie_id]
        full_date = movie["release_date"]
        if full_date is not None:
            return (False, full_date.year, full_date.month, full_date.day, movie_id)
        year = movie["release_year"]
        return (year is None, year or 0, 1, 1, movie_id)

    ready = [movie_id for movie_id in reachable if remaining[movie_id] == 0]
    order = []
    while ready:
        next_round = []
        for movie_id in sorted(ready, key=release_key):
            order.append(movie_id)
            for dependent in dependents[movie_id]:
                remaining[dependent] -= 1
                if remaining[dependent] == 0:
                    next_round.append(dependent)
        ready = next_round
    return order
