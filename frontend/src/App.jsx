import React, { useEffect, useRef, useState } from "react";

const views = ["Movies", "Rewatch Plan", "Booking"];
const copy = {
  Movies: "Add movies, manage prerequisites, and track what you’ve watched.",
  "Rewatch Plan": "See what to watch before your target movie.",
  Booking: "Find the fewest ticket bundles for your group.",
};

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const detail = data?.detail;
    if (response.status === 409 && detail?.code && detail?.message) {
      throw new Error(`409 ${detail.code}. ${detail.message}`);
    }
    throw new Error(
      typeof detail === "string" ? detail
        : Array.isArray(detail) ? detail.map((issue) => issue.msg).join(" ")
        : detail?.message || "Couldn’t reach the API. Check that FastAPI is running."
    );
  }
  return data;
}

function send(path, method, body) {
  return api(path, { method, body: JSON.stringify(body) });
}

function useCollection(path) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api(path, { signal: controller.signal })
      .then(setItems)
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, attempt]);

  function retry() {
    setError("");
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  return { items, setItems, loading, error, retry };
}

function ErrorMessage({ message, retry }) {
  return message && (
    <div className="error" role="alert">
      <span>{message}</span>
      {retry && <button type="button" className="secondary" onClick={retry}>Retry</button>}
    </div>
  );
}

function duration(minutes) {
  return `${minutes} min`;
}

function MoviePoster({ movie, large = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const url = movie.poster_url;

  return (
    <span className={large ? "movie-poster movie-poster-large" : "movie-poster"} aria-hidden="true">
      {url && url !== failedUrl
        ? <img key={url} src={url} alt="" loading={large ? "eager" : "lazy"}
            width={large ? 168 : 44} height={large ? 252 : 66}
            onError={() => setFailedUrl(url)} />
        : <span>{movie.title.charAt(0).toUpperCase()}</span>}
    </span>
  );
}

function Watched({ movie, busy, onToggle }) {
  return (
    <label className="watched">
      <input type="checkbox" checked={movie.watched} disabled={busy}
        onChange={(event) => onToggle(movie.id, event.target.checked)}
        aria-label={`Watched: ${movie.title}`} />
      Watched
    </label>
  );
}

function MovieLookup({ onSelect, onAutofill }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [selection, setSelection] = useState(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function search() {
    if (!query.trim() || pending) return;
    setPending("search");
    setError("");
    setNotice("");
    setResults(null);
    try {
      setResults(await api(`/movie-lookup/search?q=${encodeURIComponent(query.trim())}`));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending("");
    }
  }

  async function autofill() {
    setPending("details");
    setError("");
    setNotice("");
    try {
      const details = await api(`/movie-lookup/${selection.tmdb_id}/details`);
      onAutofill(details);
      setNotice(details.release_year || details.runtime_minutes
        ? "Movie info filled in. You can still edit it."
        : "TMDB has no release or runtime info for this movie.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending("");
    }
  }

  return (
    <details className="movie-lookup">
      <summary>Search TMDB</summary>
      <div className="stack compact">
        <div className="lookup-query">
          <input aria-label="Search TMDB by title" placeholder="Search by title" maxLength={200}
            value={query} disabled={Boolean(pending)}
            onChange={(event) => { setQuery(event.target.value); setResults(null); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                search();
              }
            }} />
          <button type="button" className="secondary" onClick={search} disabled={!query.trim() || Boolean(pending)}>
            {pending === "search" ? "Searching…" : "Search"}
          </button>
        </div>
        <ErrorMessage message={error} />
        {results?.length === 0 && <p className="hint" role="status">No movies found.</p>}
        {results?.length > 0 && (
          <ul className="lookup-results" aria-label="TMDB search results">
            {results.map((result) => (
              <li key={result.tmdb_id}>
                <button type="button" className="lookup-result" disabled={Boolean(pending)} onClick={() => {
                  setSelection(result);
                  setResults(null);
                  setNotice("");
                  onSelect(result);
                }}>
                  {result.poster_url && <img src={result.poster_url} width="32" height="48" loading="lazy" alt="" />}
                  {result.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selection && (
          <div className="stack compact">
            <p className="hint">Selected: {selection.title}</p>
            <button type="button" className="secondary" onClick={autofill} disabled={Boolean(pending)}>
              {pending === "details" ? "Loading movie info…" : "Autofill movie info"}
            </button>
          </div>
        )}
        {notice && <p className="hint" role="status">{notice}</p>}
        <div className="lookup-credits" role="group" aria-label="Credits">
          <a href="https://www.themoviedb.org">
            <img src="https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
              width="54" alt="TMDB" loading="lazy" />
          </a>
          <small>This product uses the TMDB API but is not endorsed or certified by TMDB.</small>
        </div>
      </div>
    </details>
  );
}

function MovieForm({ movie, movies, loading, onSave, onCancel }) {
  const [fields, setFields] = useState({
    title: movie?.title ?? "",
    year: movie?.release_year ?? "",
    runtime: movie?.runtime_minutes ?? "",
    date: movie?.release_date ?? "",
    poster: movie?.poster_url ?? "",
  });
  const [selected, setSelected] = useState(movie?.prerequisite_ids ?? []);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = movies.filter((item) =>
    item.id !== movie?.id && (
      selected.includes(item.id) ||
      `${item.title} ${item.release_year}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  function updateField(event) {
    const { name, value } = event.target;
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    const body = {
      title: fields.title,
      release_year: Number(fields.year),
      release_date: fields.date || null,
      runtime_minutes: Number(fields.runtime),
      poster_url: fields.poster.trim() || null,
      prerequisite_ids: selected,
    };
    if (movie && selected.length === movie.prerequisite_ids.length &&
      selected.every((id) => movie.prerequisite_ids.includes(id))) {
      delete body.prerequisite_ids;
    }

    setError("");
    setSaving(true);
    try {
      const saved = await (movie
        ? send(`/movies/${movie.id}`, "PATCH", body)
        : send("/movies", "POST", body));
      onSave(saved);
    } catch (failure) {
      setError(failure.message);
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <fieldset className="stack" disabled={saving || loading}>
        {!movie && <MovieLookup
          onSelect={(result) => setFields((current) => ({ ...current, title: result.title, poster: result.poster_url ?? "" }))}
          onAutofill={(details) => setFields((current) => ({
            ...current,
            year: details.release_year ?? current.year,
            date: details.release_date ?? current.date,
            runtime: details.runtime_minutes ?? current.runtime,
          }))} />}
        <label>Title<input name="title" required value={fields.title} onChange={updateField} placeholder="Movie title" /></label>
        <div className="form-pair">
          <label>Release year<input name="year" type="number" step="1" required
            value={fields.year} onChange={updateField} placeholder="2012" /></label>
          <label>Runtime (min)<input name="runtime" type="number" min="1" max="300" required
            value={fields.runtime} onChange={updateField} placeholder="120" /></label>
        </div>
        <label>Release date <small>Optional</small><input name="date" type="date" value={fields.date} onChange={updateField} /></label>
        <label>Poster URL <small>Optional</small><input name="poster" type="url" value={fields.poster} onChange={updateField} placeholder="https://" /></label>
        <div className="stack compact">
          <label htmlFor="prerequisite-search">Prerequisites <small>{selected.length} selected</small></label>
          {movies.some((item) => item.id !== movie?.id) ? (
            <>
              <input id="prerequisite-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved movies" />
              <div className="checklist">
                {candidates.length ? candidates.map((item) => (
                  <label key={item.id} className="check-row">
                    <input type="checkbox" checked={selected.includes(item.id)}
                      onChange={(event) => setSelected(event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id))} />
                    <span>{item.title}</span><small>{item.release_year}</small>
                  </label>
                )) : <p className="hint">No matches.</p>}
              </div>
            </>
          ) : <p className="hint">Add other movies to select them here.</p>}
        </div>
      </fieldset>
      <ErrorMessage message={error} />
      <div className="actions">
        <button className="primary" disabled={saving || loading}>{saving ? "Saving…" : movie ? "Save changes" : "Add movie"}</button>
        {movie && <button type="button" className="secondary" disabled={saving} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function MoviesView({ collection, pending, onToggle, onSave, onPlan }) {
  const [editingId, setEditingId] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const formHeading = useRef(null);
  const { items: movies, loading, error, retry } = collection;
  const editing = movies.find((movie) => movie.id === editingId);
  const watched = movies.filter((movie) => movie.watched).length;

  useEffect(() => {
    if (editingId !== null) formHeading.current?.focus();
  }, [editingId]);

  function selectMovie(id) {
    setEditingId(id);
    setFormKey((value) => value + 1);
  }

  return (
    <div className="columns">
      <section className="panel" aria-labelledby="library-heading">
        <div className="panel-heading">
          <h2 id="library-heading">Movie library</h2>
          {!loading && !error && <span className="muted">{watched} of {movies.length} watched</span>}
        </div>
        <ErrorMessage message={error} retry={retry} />
        {loading && <p className="empty" role="status">Loading movies…</p>}
        {!loading && !error && movies.length === 0 && <p className="empty">Your library is empty. Add a movie to get started.</p>}
        <ul className="rows library-rows">
          {movies.map((movie) => (
            <li key={movie.id} className={movie.id === editingId ? "selected-row" : ""}>
              <div className="movie-identity">
                <MoviePoster movie={movie} />
                <div className="row-title">
                  <strong>{movie.title}</strong>
                  <span>{movie.release_year} · {duration(movie.runtime_minutes)}</span>
                </div>
              </div>
              <div className="library-actions">
                <Watched movie={movie} busy={pending.has(movie.id)} onToggle={onToggle} />
                <button type="button" className="secondary" onClick={() => selectMovie(movie.id)}
                  aria-label={`Edit ${movie.title}`}>Edit</button>
                <button type="button" className="secondary plan-button" onClick={() => onPlan(movie.id)}
                  aria-label={`Plan rewatch for ${movie.title}`}>Plan rewatch</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="movie-form-heading">
        <div className="movie-form-heading">
          <h2 id="movie-form-heading" ref={formHeading} tabIndex={-1}>{editing ? "Edit movie" : "Add movie"}</h2>
          {editing && <p className="hint">{editing.title}</p>}
        </div>
        <MovieForm key={formKey} movie={editing} movies={movies} loading={loading}
          onSave={(movie) => { onSave(movie); selectMovie(null); }}
          onCancel={() => selectMovie(null)} />
      </section>
    </div>
  );
}

function RewatchView({ collection, pending, onToggle, target, setTarget }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const { items: movies, loading, error, retry } = collection;
  const targetMovie = movies.find((movie) => String(movie.id) === target);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    api(`/movies/${target}/rewatch-order`, { signal: controller.signal })
      .then((plan) => setResult({ target, movies, attempt, plan }))
      .catch((failure) => {
        if (!controller.signal.aborted) setResult({ target, movies, attempt, error: failure.message });
      });
    return () => controller.abort();
  }, [target, movies, attempt]);

  const current = result?.target === target ? result : null;
  const plan = current?.plan;
  const refreshing = Boolean(target) && (current?.movies !== movies || current?.attempt !== attempt);

  return (
    <div className="rewatch-layout">
      <section className="panel" aria-label="Target movie">
        <ErrorMessage message={error} retry={retry} />
        <label className="target-picker">Choose a target movie
          <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={loading || !movies.length}>
            <option value="">{loading ? "Loading movies…" : "Choose a movie"}</option>
            {movies.map((movie) => <option key={movie.id} value={movie.id}>{movie.title} ({movie.release_year})</option>)}
          </select>
        </label>
        {!loading && !error && !movies.length && <p className="hint">Add a movie in Movies to make a plan.</p>}
        {targetMovie && (
          <div className="rewatch-target">
            <MoviePoster movie={targetMovie} large />
            <div className="target-details">
              <h2>{targetMovie.title}</h2>
              <p className="muted">{targetMovie.release_year} · {duration(targetMovie.runtime_minutes)}</p>
              {plan && (
                <div className="target-progress">
                  <div className="progress-summary" aria-live="polite">
                    <strong>{plan.watched_count} of {plan.total_prerequisite_count} watched</strong>
                    <span>Remaining: {duration(plan.unwatched_runtime_minutes)}</span>
                  </div>
                  <progress aria-label="Rewatch progress"
                    value={plan.total_prerequisite_count === 0 ? 1 : plan.watched_count}
                    max={plan.total_prerequisite_count || 1} />
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      {target && (
        <section className="panel" aria-labelledby="watch-order-heading" aria-busy={refreshing}>
          <h2 id="watch-order-heading">Watch before {targetMovie?.title ?? "the target movie"}</h2>
          {refreshing && !plan && <p className="empty" role="status">Loading watch order…</p>}
          <ErrorMessage message={!refreshing ? current?.error : ""} retry={() => setAttempt((value) => value + 1)} />
          {plan?.movies.length === 0 && <p className="empty">This movie has no prerequisites.</p>}
          {plan?.movies.length > 0 && (
            <ol className="rows ordered">
              {plan.movies.map((movie, index) => (
                <li key={movie.id}>
                  <span className="order-number">{index + 1}</span>
                  <div className="movie-identity">
                    <MoviePoster movie={movie} />
                    <div className="row-title"><strong>{movie.title}</strong><span>{movie.release_year} · {duration(movie.runtime_minutes)}</span></div>
                  </div>
                  <Watched movie={movies.find((item) => item.id === movie.id) ?? movie}
                    busy={pending.has(movie.id)} onToggle={onToggle} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function BookingView() {
  const { items: cinemas, setItems, loading, error, retry } = useCollection("/cinemas");
  const [cinemaId, setCinemaId] = useState("");
  const [groupSize, setGroupSize] = useState("");
  const [quote, setQuote] = useState(null);
  const [bookingError, setBookingError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cinemaError, setCinemaError] = useState("");
  const cinema = cinemas.find((item) => String(item.id) === cinemaId);

  function resetQuote() {
    setQuote(null);
    setBookingError("");
  }

  async function getQuote(event) {
    event.preventDefault();
    resetQuote();
    setRequesting(true);
    try {
      setQuote(await api(`/cinemas/${cinemaId}/booking?groupSize=${Number(groupSize)}`));
    } catch (failure) {
      setBookingError(failure.message);
    } finally {
      setRequesting(false);
    }
  }

  async function addCinema(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const sizes = fields.get("sizes").split(",").map((size) => size.trim());
    if (sizes.some((size) => !/^\d+$/.test(size))) {
      setCinemaError("Enter bundle sizes as whole numbers separated by commas.");
      return;
    }
    setCinemaError("");
    setAdding(true);
    try {
      const saved = await send("/cinemas", "POST", { name: fields.get("name"), bundle_sizes: sizes.map(Number) });
      setItems((items) => [...items, saved]);
      setCinemaId(String(saved.id));
      resetQuote();
      form.reset();
    } catch (failure) {
      setCinemaError(failure.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="columns reversed">
      <section className="panel">
        <h2>Booking details</h2>
        <ErrorMessage message={error} retry={retry} />
        <form className="stack" onSubmit={getQuote}>
          <fieldset className="stack" disabled={requesting || adding || loading}>
            <label>Cinema
              <select value={cinemaId} required onChange={(event) => { setCinemaId(event.target.value); resetQuote(); }}>
                <option value="">{loading ? "Loading cinemas…" : "Choose a cinema"}</option>
                {cinemas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {cinema && <p className="hint">Bundle sizes: {cinema.bundle_sizes.join(", ")}</p>}
            {!loading && !error && !cinemas.length && <p className="hint">Add a cinema below to get started.</p>}
            <label>Group size
              <input type="number" min="1" max="10000" required value={groupSize} placeholder="6"
                onChange={(event) => { setGroupSize(event.target.value); resetQuote(); }} />
            </label>
            <button className="primary" disabled={!cinema}>{requesting ? "Calculating…" : "Get quote"}</button>
          </fieldset>
        </form>
        <details className="cinema-form">
          <summary>Add a cinema</summary>
          <form className="stack" onSubmit={addCinema}>
            <fieldset className="stack" disabled={adding || requesting || loading}>
              <label>Name<input name="name" required /></label>
              <label>Bundle sizes<input name="sizes" required placeholder="1, 3, 4" /></label>
              <button className="secondary">{adding ? "Saving…" : "Save cinema"}</button>
            </fieldset>
            <ErrorMessage message={cinemaError} />
          </form>
        </details>
      </section>
      <section className="panel" aria-live="polite">
        <h2>Booking quote</h2>
        <ErrorMessage message={bookingError} />
        {requesting && <p className="empty">Calculating quote…</p>}
        {!quote && !requesting && !bookingError && <p className="empty">Choose a cinema and enter a group size to get a quote.</p>}
        {quote && (quote.possible ? (
          <>
            <p className="progress-summary"><strong>{quote.minimum_bundle_count} {quote.minimum_bundle_count === 1 ? "bundle" : "bundles"} total</strong><span className="muted">{groupSize} seats</span></p>
            <ul className="rows">
              {Object.entries(quote.bundle_quantities).map(([size, quantity]) => (
                <li key={size} className="quote-row"><strong>Bundle of {size}</strong><span>× {quantity}</span></li>
              ))}
            </ul>
          </>
        ) : <p className="empty"><strong>Not possible.</strong> The available bundles can’t seat exactly {groupSize} people.</p>)}
      </section>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("Movies");
  const [rewatchTarget, setRewatchTarget] = useState("");
  const [pending, setPending] = useState(new Set());
  const [watchError, setWatchError] = useState("");
  const collection = useCollection("/movies");

  function openRewatch(movieId) {
    setRewatchTarget(String(movieId));
    setWatchError("");
    setView("Rewatch Plan");
  }

  function saveMovie(movie) {
    collection.setItems((items) => items.some((item) => item.id === movie.id)
      ? items.map((item) => item.id === movie.id ? movie : item)
      : [...items, movie]);
  }

  async function toggleWatched(id, watched) {
    setPending((ids) => new Set(ids).add(id));
    setWatchError("");
    try {
      const saved = await send(`/movies/${id}`, "PATCH", { watched });
      collection.setItems((items) => items.map((item) => item.id === id ? { ...item, watched: saved.watched } : item));
    } catch (failure) {
      setWatchError(failure.message);
    } finally {
      setPending((ids) => new Set([...ids].filter((item) => item !== id)));
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="shell header-content">
          <div className="brand"><span className="brand-mark" aria-hidden="true" />Doomsday Ready</div>
          <nav aria-label="Main navigation">
            {views.map((item) => (
              <button type="button" key={item} aria-current={view === item ? "page" : undefined}
                onClick={() => { setView(item); setWatchError(""); }}>{item}</button>
            ))}
          </nav>
        </div>
      </header>
      <main className="shell">
        <div className="intro">
          <h1>{view}</h1>
          <p>{copy[view]}</p>
        </div>
        {view !== "Booking" && <ErrorMessage message={watchError} />}
        {view === "Movies" && <MoviesView collection={collection} pending={pending} onToggle={toggleWatched} onSave={saveMovie} onPlan={openRewatch} />}
        {view === "Rewatch Plan" && <RewatchView collection={collection} pending={pending} onToggle={toggleWatched}
          target={rewatchTarget} setTarget={setRewatchTarget} />}
        {view === "Booking" && <BookingView />}
      </main>
    </>
  );
}
