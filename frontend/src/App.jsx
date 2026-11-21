import React, { useEffect, useRef, useState } from "react";

const views = ["Movies", "Rewatch Plan", "Booking"];
const copy = {
  Movies: "Add movies, manage prerequisites, and track what you’ve watched.",
  "Rewatch Plan": "See what to watch before your target movie.",
  Booking: "Set up cinema bundles and find the fewest to buy for your group.",
};
const viewStyles = { Movies: "movies", "Rewatch Plan": "rewatch", Booking: "booking" };

function readRoute() {
  const hash = window.location.hash;
  const rewatch = /^#rewatch(?:\/([1-9]\d{0,9}))?$/.exec(hash);
  if (rewatch) return { view: "Rewatch Plan", target: rewatch[1] ?? "" };
  return { view: hash === "#booking" ? "Booking" : "Movies", target: "" };
}

function rewatchHref(movieId) {
  return movieId ? `#rewatch/${movieId}` : "#rewatch";
}

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
      <summary>Search TMDB <small>Optional</small></summary>
      <div className="lookup-body">
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
          <button type="button" className="secondary lookup-search" onClick={search} disabled={!query.trim() || Boolean(pending)}>
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
          <div className="lookup-selection">
            <MoviePoster movie={selection} />
            <div className="lookup-selection-info">
              <strong>{selection.title}</strong>
              <p className="hint">Fill in the release date, year, and runtime.</p>
              <button type="button" className="primary lookup-autofill" onClick={autofill} disabled={Boolean(pending)}>
                {pending === "details" ? "Loading movie info…" : "Autofill movie info"}
              </button>
            </div>
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

function MoviesView({ collection, pending, onToggle, onSave }) {
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
                <a className="secondary plan-button" href={rewatchHref(movie.id)}
                  aria-label={`Plan rewatch for ${movie.title}`}>Plan rewatch</a>
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

function RewatchView({ collection, pending, onToggle, target }) {
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
      <section className="panel" aria-labelledby="target-picker-heading">
        <h2 id="target-picker-heading">Choose a target movie</h2>
        <ErrorMessage message={error} retry={retry} />
        {loading && <p className="empty" role="status">Loading movies…</p>}
        {!loading && !error && !movies.length && <p className="empty">Add a movie in Movies to make a plan.</p>}
        <div className={targetMovie ? "rewatch-overview has-target" : "rewatch-overview"}>
          {movies.length > 0 && (
            <ul className="target-options" role="list">
              {movies.map((movie) => {
                const isSelected = movie.id === targetMovie?.id;
                return (
                  <li key={movie.id}>
                    <a className="target-option" href={rewatchHref(movie.id)} aria-current={isSelected ? "true" : undefined}>
                      <MoviePoster movie={movie} />
                      <span className="row-title">
                        <strong>{movie.title}</strong>
                        <span>{movie.release_year} · {duration(movie.runtime_minutes)}</span>
                      </span>
                      {isSelected && <span className="target-selected">Selected</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
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
        </div>
      </section>
      {target && (
        <section className="panel" aria-labelledby="watch-order-heading" aria-busy={refreshing}>
          <h2 id="watch-order-heading">Watch before {targetMovie?.title ?? "the target movie"}</h2>
          {refreshing && !plan && <p className="empty" role="status">Loading watch order…</p>}
          <ErrorMessage message={!refreshing ? current?.error : ""} retry={() => setAttempt((value) => value + 1)} />
          {plan?.movies.length === 0 && <p className="empty">This movie has no prerequisites.</p>}
          {plan?.movies.length > 0 && (
            <>
              <p className="watch-order-instruction">Watch in the order shown below, starting at 1.</p>
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
            </>
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
  const [cinemaNotice, setCinemaNotice] = useState("");
  const cinemaNameInput = useRef(null);
  const groupSizeInput = useRef(null);
  const cinema = cinemas.find((item) => String(item.id) === cinemaId);

  useEffect(() => {
    if (cinemaNotice && !adding) groupSizeInput.current?.focus();
  }, [cinemaNotice, adding]);

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
    setCinemaNotice("");
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
      setCinemaNotice(`${saved.name} was added and selected for your quote.`);
    } catch (failure) {
      setCinemaError(failure.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="columns booking-layout">
      <div className="booking-workspace">
        <section className="panel booking-panel" aria-labelledby="booking-heading">
          <div className="section-heading">
            <h2 id="booking-heading">Get a booking quote</h2>
            <p>Choose a saved cinema and enter the number of seats you need.</p>
          </div>
          <ErrorMessage message={error} retry={retry} />
          {!loading && !error && !cinemas.length ? (
            <div className="empty booking-empty">
              <p>No cinemas yet. Create one to set the bundle sizes it sells.</p>
              <button type="button" className="secondary" onClick={() => cinemaNameInput.current?.focus()}>
                Add your first cinema
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={getQuote}>
              <fieldset className="stack" disabled={requesting || adding || loading}>
                <div className="booking-fields">
                  <label>Saved cinema
                    <select value={cinemaId} required onChange={(event) => { setCinemaId(event.target.value); resetQuote(); }}>
                      <option value="">{loading ? "Loading cinemas…" : "Choose a cinema"}</option>
                      {cinemas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label>Group size
                    <input ref={groupSizeInput} type="number" min="1" max="10000" required value={groupSize} placeholder="e.g. 6"
                      onChange={(event) => { setGroupSize(event.target.value); resetQuote(); }} />
                  </label>
                </div>
                {cinema && (
                  <div className="bundle-options">
                    <span>Available bundles</span>
                    <ul aria-label="Available bundle sizes">
                      {cinema.bundle_sizes.map((size) => <li key={size}>{size} {size === 1 ? "seat" : "seats"}</li>)}
                    </ul>
                  </div>
                )}
                <button className="primary" disabled={!cinema}>{requesting ? "Calculating…" : "Get quote"}</button>
              </fieldset>
            </form>
          )}
        </section>
        <div aria-live="polite">
          <ErrorMessage message={bookingError} />
          {requesting && <p className="panel">Calculating quote…</p>}
          {quote && (quote.possible ? (
            <section className="panel booking-result" aria-labelledby="bundle-results-heading">
              <div className="section-heading">
                <h2 id="bundle-results-heading">Bundles to buy</h2>
                <p>{cinema?.name} · {groupSize} {Number(groupSize) === 1 ? "seat" : "seats"} · {quote.minimum_bundle_count} {quote.minimum_bundle_count === 1 ? "bundle" : "bundles"} total</p>
              </div>
              <ul className="rows">
                {Object.entries(quote.bundle_quantities).map(([size, quantity]) => (
                  <li key={size} className="quote-row">
                    <strong>{size} {Number(size) === 1 ? "seat" : "seats"} per bundle</strong>
                    <span className="bundle-quantity">Buy {quantity}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="panel booking-unavailable">
              <h2>Not possible</h2>
              <p>{cinema?.name} can’t seat exactly {groupSize} with its available bundles. Try a different group size or cinema.</p>
            </section>
          ))}
        </div>
      </div>
      <section className="panel cinema-panel" aria-labelledby="add-cinema-heading">
        <div className="section-heading">
          <h2 id="add-cinema-heading">Add a cinema</h2>
          <p>Save the cinema and the ticket bundles it offers.</p>
        </div>
        <form className="stack" onSubmit={addCinema}>
          <fieldset className="stack" disabled={adding || requesting || loading}>
            <label>Cinema name<input ref={cinemaNameInput} name="name" required placeholder="e.g. Central Cinema" /></label>
            <label>Seats per bundle
              <input name="sizes" required placeholder="e.g. 1, 3, 4" aria-describedby="bundle-sizes-hint" />
            </label>
            <p className="hint bundle-hint" id="bundle-sizes-hint">Enter 1 to 10 different sizes, separated by commas. Each size can be 1 to 500 seats.</p>
            <button className="primary">{adding ? "Saving…" : "Save cinema"}</button>
          </fieldset>
          <ErrorMessage message={cinemaError} />
          {cinemaNotice && <p className="cinema-notice" role="status">{cinemaNotice}</p>}
        </form>
      </section>
    </div>
  );
}

export default function App() {
  const [{ view, target }, setRoute] = useState(readRoute);
  const [pending, setPending] = useState(new Set());
  const [watchError, setWatchError] = useState("");
  const collection = useCollection("/movies");

  useEffect(() => {
    function onNavigate() {
      setRoute(readRoute());
      setWatchError("");
    }
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);

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
              <a key={item} data-view={viewStyles[item]} aria-current={view === item ? "page" : undefined}
                href={item === "Rewatch Plan" ? rewatchHref(target) : `#${viewStyles[item]}`}>{item}</a>
            ))}
          </nav>
          <a className="api-docs-link" href="/docs">API Docs</a>
        </div>
      </header>
      <main className="shell" data-view={viewStyles[view]}>
        <div className="intro">
          <h1>{view}</h1>
          <p>{copy[view]}</p>
        </div>
        {view !== "Booking" && <ErrorMessage message={watchError} />}
        {view === "Movies" && <MoviesView collection={collection} pending={pending} onToggle={toggleWatched} onSave={saveMovie} />}
        {view === "Rewatch Plan" && <RewatchView collection={collection} pending={pending} onToggle={toggleWatched} target={target} />}
        {view === "Booking" && <BookingView />}
      </main>
    </>
  );
}
