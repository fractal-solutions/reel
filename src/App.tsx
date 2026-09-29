import { createContext, useContext, useEffect, useRef, useState, type AnchorHTMLAttributes, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Award, BarChart3, Bookmark,
  Check, ChevronLeft, ChevronRight, CircleDollarSign, Clapperboard, Clock3, Compass,
  Film as FilmIcon, Globe2, House, LayoutDashboard, LoaderCircle, Menu, MessageCircle,
  Play, Plus, Search, Send, Share2, Star, Ticket, TrendingUp, Trophy, Upload, Wallet, X, Eye,
} from "lucide-react";
import { api, formatDuration, type Category, type Film, type FilmList, type Plan, type ProgressItem, type Review } from "./api";
import "./index.css";

type Router = { path: string; navigate: (to: string) => void };
const RouterContext = createContext<Router>({ path: "/", navigate: () => undefined });

function Link({ href, children, className, ...props }: { href: string; children: ReactNode; className?: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useContext(RouterContext);
  const { onClick, ...anchorProps } = props;
  return <a {...anchorProps} href={href} className={className} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      navigate(href);
    }
  }}>{children}</a>;
}

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    if (!path) {
      setLoading(false);
      setData(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    api<T>(path).then((result) => {
      if (active) setData(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Unable to load this page.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, version]);
  return { data, error, loading, reload: () => setVersion((current) => current + 1) };
}

function useRouter() {
  return useContext(RouterContext);
}

export function App() {
  const [path, setPath] = useState(() => `${window.location.pathname}${window.location.search}`);
  const navigate = (to: string) => {
    if (to === path) return;
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const onPopState = () => setPath(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const route = path.split("?")[0] || "/";
  let page: ReactNode;
  if (route === "/") page = <Home />;
  else if (route === "/browse") page = <Browse />;
  else if (route.startsWith("/film/")) page = <FilmDetail id={route.split("/")[2] || ""} />;
  else if (route === "/watchlist") page = <WatchlistPage />;
  else if (route === "/continue-watching") page = <ContinuePage />;
  else if (route === "/plans") page = <PlansPage />;
  else if (route === "/reel") page = <ReelPage />;
  else if (route === "/creator" || route === "/creator/") page = <CreatorDashboard />;
  else if (route === "/creator/films") page = <CreatorFilms />;
  else if (route === "/creator/upload") page = <UploadFilm />;
  else if (route === "/creator/analytics") page = <CreatorAnalytics />;
  else if (route === "/creator/earnings") page = <CreatorEarnings />;
  else page = <NotFound />;

  return <RouterContext.Provider value={{ path, navigate }}>
    <div className="app-shell"><Header />{page}<Footer /></div>
  </RouterContext.Provider>;
}

function Header() {
  const { path } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const creator = path.startsWith("/creator");
  const nav = creator
    ? [{ to: "/creator", label: "Overview", icon: LayoutDashboard }, { to: "/creator/films", label: "My films", icon: Clapperboard }, { to: "/creator/analytics", label: "Analytics", icon: BarChart3 }, { to: "/creator/earnings", label: "Earnings", icon: Wallet }]
    : [{ to: "/", label: "Home", icon: House }, { to: "/browse", label: "Explore", icon: Compass }, { to: "/reel", label: "The Reel", icon: FilmIcon }, { to: "/watchlist", label: "Watchlist", icon: Bookmark }];
  return <header className="site-header">
    <div className="nav-wrap">
      <Link href="/" className="brand"><span className="brand-mark"><FilmIcon size={19} /></span><span>Filamu<span className="brand-accent">Reel</span></span></Link>
      <nav className={`main-nav ${menuOpen ? "nav-open" : ""}`}>
        {nav.map(({ to, label, icon: Icon }) => <Link key={to} href={to} className={`nav-link ${path.split("?")[0] === to ? "active" : ""}`} onClick={() => setMenuOpen(false)}><Icon size={16} />{label}</Link>)}
      </nav>
      <div className="nav-actions">
        {!creator && <Link href="/plans" className="button button-outline button-small"><Ticket size={15} /> Membership</Link>}
        <Link href={creator ? "/" : "/creator"} className="studio-link">{creator ? "Exit Studio" : "Creator studio"}<ArrowUpRight size={15} /></Link>
        <button className="icon-button menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </div>
  </header>;
}

function Footer() {
  return <footer className="site-footer"><Link href="/" className="brand"><span className="brand-mark"><FilmIcon size={17} /></span><span>Filamu<span className="brand-accent">Reel</span></span></Link><p>A home for stories born across Africa.</p><span className="footer-copy">© {new Date().getFullYear()} FilamuReel</span></footer>;
}

function PageFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`page-content ${wide ? "wide" : ""}`}>{children}</main>;
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2>{description && <p className="muted">{description}</p>}</div>{action}</div>;
}

function Notice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="notice" role="alert"><span>{message}</span>{onRetry && <button className="text-button" onClick={onRetry}>Try again</button>}</div>;
}

function Loading({ label = "Curating the collection…" }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

function EmptyState({ title, message, href, action }: { title: string; message: string; href?: string; action?: string }) {
  return <div className="empty-state"><span className="empty-icon"><FilmIcon size={24} /></span><h3>{title}</h3><p>{message}</p>{href && <Link href={href} className="button button-outline">{action || "Explore films"}<ArrowRight size={16} /></Link>}</div>;
}

function Poster({ film, className = "" }: { film: Film; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <div className={`poster ${className}`} style={film.posterUrl && !failed ? { backgroundImage: `url("${film.posterUrl}")` } : undefined}>
    {(!film.posterUrl || failed) && <div className="poster-fallback"><FilmIcon size={32} /><span>{film.title}</span></div>}
    {film.posterUrl && !failed && <img src={film.posterUrl} alt={film.title} loading="lazy" onError={() => setFailed(true)} />}
  </div>;
}

function FilmCard({ film, landscape = false }: { film: Film; landscape?: boolean }) {
  return <Link href={`/film/${film.id}`} className={`film-card ${landscape ? "film-card-landscape" : ""}`}>
    <div className="film-art"><Poster film={film} /><div className="film-art-shade" />
      <div className="film-card-top">{film.isFestivalWinner && <span className="tag tag-gold"><Trophy size={11} /> Laureate</span>}{film.monetization === "subscription" && <span className="tag">Premium</span>}</div>
      <span className="film-play"><Play size={18} fill="currentColor" /></span>
      <div className="film-rating"><Star size={13} fill="currentColor" />{film.rating ? film.rating.toFixed(1) : "New"}<span>·</span>{formatDuration(film.duration)}</div>
    </div>
    <div className="film-meta"><h3>{film.title}</h3><p>{film.category || film.genre || "Feature"}{film.region ? ` · ${film.region}` : ""}</p></div>
  </Link>;
}

function FilmRail({ title, eyebrow, films }: { title: string; eyebrow?: string; films: Film[] }) {
  const [offset, setOffset] = useState(0);
  if (!films.length) return null;
  const move = (step: number) => setOffset((current) => Math.min(Math.max(current + step, 0), Math.max(0, films.length - 4)));
  return <section className="film-rail">
    <SectionHeading eyebrow={eyebrow} title={title} action={<div className="rail-controls"><button className="icon-button" aria-label="Scroll left" onClick={() => move(-3)}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Scroll right" onClick={() => move(3)}><ChevronRight size={18} /></button></div>} />
    <div className="rail-window"><div className="rail-track" style={{ transform: `translateX(calc(${offset} * (var(--card-width) + var(--rail-gap)) * -1))` }}>{films.map((film) => <FilmCard key={film.id} film={film} />)}</div></div>
  </section>;
}

function Home() {
  const featured = useLoad<Film[]>("featured");
  const trending = useLoad<Film[]>("trending?limit=12");
  const newFilms = useLoad<Film[]>("new-releases?limit=12");
  const laureates = useLoad<Film[]>("festival-winners");
  const free = useLoad<Film[]>("free-films?limit=12");
  const [slide, setSlide] = useState(0);
  const heroFilms = featured.data || [];
  useEffect(() => {
    if (heroFilms.length < 2) return;
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % heroFilms.length), 7000);
    return () => window.clearInterval(timer);
  }, [heroFilms.length]);
  const hero = heroFilms[slide];
  return <>
    <section className="hero">
      {hero?.posterUrl && <img className="hero-image" src={hero.posterUrl} alt="" />}
      <div className="hero-overlay" />
      <div className="hero-content">
        <p className="eyebrow"><span className="live-dot" /> THE AFRICAN FILM COLLECTION</p>
        <h1>{hero?.title || "Stories without borders."}</h1>
        <p className="hero-copy">{hero?.description || "A curated home for cinema from every corner of the continent. Discover bold voices, unforgettable stories and films that stay with you."}</p>
        <div className="hero-details">{hero?.isFestivalWinner && <span><Award size={15} /> Festival laureate</span>}{hero?.region && <span><Globe2 size={15} />{hero.region}</span>}{hero?.duration && <span><Clock3 size={15} />{formatDuration(hero.duration)}</span>}</div>
        <div className="hero-actions"><Link href={hero ? `/film/${hero.id}` : "/browse"} className="button button-gold"><Play size={16} fill="currentColor" />Explore the film</Link><Link href="/browse" className="button button-glass">Browse all films<ArrowRight size={16} /></Link></div>
      </div>
      {heroFilms.length > 1 && <div className="hero-pager">{heroFilms.map((film, index) => <button aria-label={`Show ${film.title}`} key={film.id} onClick={() => setSlide(index)} className={slide === index ? "selected" : ""} />)}</div>}
      <div className="hero-index"><span>0{slide + 1}</span><i />0{Math.max(1, heroFilms.length)}</div>
    </section>
    <PageFrame wide>
      <div className="home-intro"><div><p className="eyebrow">A CINEMA OF OUR OWN</p><h2>See the world<br /><em>through our lens.</em></h2></div><p>From timeless classics to the next generation of independent voices, find the stories you came looking for — and the ones you didn't know you needed.</p></div>
      {featured.error && <Notice message={featured.error} onRetry={featured.reload} />}
      {featured.loading && !hero && <Loading />}
      {laureates.error && <Notice message={laureates.error} onRetry={laureates.reload} />}
      <FilmRail eyebrow="FESTIVAL CIRCUIT" title="Award-winning stories" films={laureates.data || []} />
      {trending.error && <Notice message={trending.error} onRetry={trending.reload} />}
      <FilmRail eyebrow="THE PEOPLE HAVE SPOKEN" title="Trending now" films={trending.data || []} />
      {newFilms.error && <Notice message={newFilms.error} onRetry={newFilms.reload} />}
      <FilmRail eyebrow="JUST ARRIVED" title="New releases" films={newFilms.data || []} />
      {free.error && <Notice message={free.error} onRetry={free.reload} />}
      <FilmRail eyebrow="OPEN ACCESS" title="Free to watch" films={free.data || []} />
      <div className="creator-callout"><div><p className="eyebrow">YOUR STORY BELONGS HERE</p><h2>Make room for a new voice.</h2><p>Bring your film to an audience that values the stories you have to tell.</p><Link href="/creator" className="button button-gold">Enter creator studio<ArrowRight size={16} /></Link></div><div className="callout-art"><span>F</span><span>R</span></div></div>
    </PageFrame>
  </>;
}

function Browse() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("newest");
  const [query, setQuery] = useState("");
  const categories = useLoad<Category[]>("categories");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ sort, limit: "60" });
  if (query) params.set("search", query);
  if (category) params.set("category", category);
  const films = useLoad<FilmList>(`films?${params.toString()}`);
  return <PageFrame wide><section className="page-hero compact"><p className="eyebrow">THE COLLECTION</p><h1>Stories worth<br /><em>staying for.</em></h1><p>Discover cinema across borders, genres and generations.</p></section>
    <div className="browse-tools"><label className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles, directors, genres…" /><kbd>↵</kbd></label>
      <div className="filter-controls"><label><span className="sr-only">Filter by category</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(categories.data || []).map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
      <label><span className="sr-only">Sort films</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="trending">Trending</option><option value="rating">Top rated</option><option value="views">Most watched</option></select></label></div>
    </div>
    {categories.error && <Notice message={categories.error} onRetry={categories.reload} />}
    {films.error && <Notice message={films.error} onRetry={films.reload} />}
    <div className="results-label"><span>{films.data?.total ?? films.data?.films?.length ?? 0} films</span>{query && <span>for “{query}”</span>}</div>
    {films.loading ? <Loading /> : films.data?.films?.length ? <div className="film-grid">{films.data.films.map((film) => <FilmCard key={film.id} film={film} />)}</div> : <EmptyState title="Nothing on this reel yet" message="Try a different search or clear your filters to see more films." />}
  </PageFrame>;
}

function FilmDetail({ id }: { id: string }) {
  const filmId = Number(id);
  const filmState = useLoad<Film>(Number.isInteger(filmId) ? `films/${filmId}` : null);
  const related = useLoad<Film[]>(Number.isInteger(filmId) ? `films/${filmId}/related` : null);
  const reviewsState = useLoad<Review[]>(Number.isInteger(filmId) ? `films/${filmId}/reviews` : null);
  const [mutationError, setMutationError] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const lastProgressCheckpoint = useRef(0);
  const [viewingEventId, setViewingEventId] = useState<number | null>(null);
  const { navigate } = useRouter();
  const film = filmState.data;
  const toggleWatchlist = async () => {
    if (!film) return;
    setBusy(true); setMutationError("");
    try {
      await api(film.isInWatchlist ? `watchlist/${film.id}` : "watchlist", {
        method: film.isInWatchlist ? "DELETE" : "POST",
        ...(film.isInWatchlist ? {} : { body: JSON.stringify({ filmId: film.id }) }),
      });
      filmState.reload();
    } catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to update watchlist."); }
    finally { setBusy(false); }
  };
  const submitReview = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMutationError("");
    try {
      await api(`films/${filmId}/reviews`, { method: "POST", body: JSON.stringify({ rating, comment }) });
      setComment(""); setReviewOpen(false); reviewsState.reload(); filmState.reload();
    } catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to submit review."); }
    finally { setBusy(false); }
  };
  const recordProgress = async (current: number, total: number) => {
    try {
      await api("progress", {
        method: "POST",
        body: JSON.stringify({
          filmId,
          progressSeconds: Math.floor(current),
          totalSeconds: Math.floor(total),
          ...(viewingEventId === null ? {} : { viewingEventId }),
        }),
      });
    }
    catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to save viewing progress."); }
  };
  const startPlayback = async () => {
    if (!film) return;
    if (!film.videoUrl && !film.trailerUrl) {
      setMutationError("A video has not been uploaded or linked for this film yet.");
      return;
    }
    setBusy(true);
    setMutationError("");
    try {
      const session = await api<{ viewingEventId: number }>(`films/${film.id}/view`, { method: "POST" });
      setViewingEventId(session.viewingEventId);
      lastProgressCheckpoint.current = 0;
      setVideoOpen(true);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Unable to start film playback.");
    } finally {
      setBusy(false);
    }
  };
  if (filmState.loading) return <PageFrame><Loading label="Finding your film…" /></PageFrame>;
  if (filmState.error) return <PageFrame><Notice message={filmState.error} onRetry={filmState.reload} /></PageFrame>;
  if (!film) return <PageFrame><EmptyState title="Film not found" message="This title may have moved or is no longer available." href="/browse" /></PageFrame>;
  return <>
    <section className="detail-hero">
      {film.posterUrl && <img src={film.posterUrl} className="detail-backdrop" alt="" />}
      <div className="detail-veil" />
      <div className="detail-content">
        <div className="detail-poster"><Poster film={film} /></div>
        <div className="detail-copy">{film.isFestivalWinner && <p className="eyebrow gold-text"><Award size={15} /> FESTIVAL LAUREATE</p>}<h1>{film.title}</h1>
          <div className="detail-facts"><span><Star size={14} fill="currentColor" />{film.rating ? film.rating.toFixed(1) : "New"}</span><span>{new Date(film.createdAt).getFullYear()}</span><span>{formatDuration(film.duration)}</span><span>{film.category || film.genre}</span>{film.region && <span>{film.region}</span>}</div>
          <p className="detail-description">{film.description || "A story from the heart of the continent."}</p>
          <div className="hero-actions"><button className="button button-gold" onClick={() => void startPlayback()} disabled={busy}><Play size={16} fill="currentColor" />Play film</button>
            <button className="button button-glass" onClick={toggleWatchlist} disabled={busy}>{film.isInWatchlist ? <Check size={16} /> : <Plus size={16} />}{film.isInWatchlist ? "Saved to watchlist" : "Add to watchlist"}</button>
            <button className="icon-button share-button" onClick={() => navigator.clipboard.writeText(location.href).then(() => setMutationError("Link copied to clipboard.")).catch(() => setMutationError("Unable to copy link in this browser."))} aria-label="Copy film link"><Share2 size={17} /></button>
          </div>
        </div>
      </div>
    </section>
    <PageFrame wide><div className="detail-columns"><div>
      <div className="detail-info">{film.director && <div><span>Directed by</span><strong>{film.director}</strong></div>}{film.language && <div><span>Language</span><strong>{film.language}</strong></div>}{film.cast && <div className="cast-row"><span>Featuring</span><strong>{film.cast}</strong></div>}{film.creatorName && <div><span>Presented by</span><strong>{film.creatorName}</strong></div>}</div>
      {film.tags?.length > 0 && <div className="film-tags">{film.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      <div className="reviews-section"><SectionHeading eyebrow="FROM THE AUDIENCE" title="Reviews" action={<button className="text-button" onClick={() => setReviewOpen((open) => !open)}><MessageCircle size={15} />Write a review</button>} />
        {reviewOpen && <form className="review-form" onSubmit={submitReview}><label>Your rating <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5,4,3,2,1].map((value) => <option value={value} key={value}>{value} stars</option>)}</select></label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What stayed with you?" rows={3} /><button className="button button-gold" disabled={busy}><Send size={15} />Submit review</button></form>}
        {reviewsState.error && <Notice message={reviewsState.error} onRetry={reviewsState.reload} />}
        {reviewsState.loading ? <Loading label="Loading reviews…" /> : reviewsState.data?.length ? <div className="review-list">{reviewsState.data.map((review) => <article className="review-card" key={review.id}><div className="review-heading"><div className="avatar">{review.userName?.[0] || "F"}</div><div><strong>{review.userName || "Film lover"}</strong><small>{new Date(review.createdAt).toLocaleDateString()}</small></div><span className="review-rating"><Star size={13} fill="currentColor" />{review.rating}.0</span></div>{review.comment && <p>{review.comment}</p>}</article>)}</div> : <p className="muted review-empty">Be the first to share what you thought of this film.</p>}
      </div>
    </div><aside className="detail-aside"><div className="membership-card"><CrownIcon /><p className="eyebrow">THE PREMIERE COLLECTION</p><h3>More cinema.<br />Fewer interruptions.</h3><p>Support filmmakers and unlock the complete collection with a membership.</p><Link href="/plans" className="button button-gold button-block">Explore membership<ArrowRight size={15} /></Link></div></aside></div>
      {related.error && <Notice message={related.error} onRetry={related.reload} />}<FilmRail eyebrow="KEEP EXPLORING" title="More like this" films={related.data || []} />
    </PageFrame>
    {videoOpen && <div className="modal-backdrop" role="presentation" onClick={() => setVideoOpen(false)}><div className="video-modal" role="dialog" aria-modal="true" aria-label={`Play ${film.title}`} onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setVideoOpen(false)} aria-label="Close player"><X size={21} /></button><video controls autoPlay src={film.videoUrl || film.trailerUrl || undefined} onTimeUpdate={(event) => { const v = event.currentTarget; if (v.currentTime - lastProgressCheckpoint.current >= 15) { lastProgressCheckpoint.current = v.currentTime; void recordProgress(v.currentTime, v.duration || film.duration || 0); } }} onEnded={(event) => { const v = event.currentTarget; void recordProgress(v.currentTime, v.duration || film.duration || 0); }} /></div></div>}
    {mutationError && <div className="toast-message" role="status">{mutationError}<button onClick={() => setMutationError("")} aria-label="Dismiss"><X size={14} /></button></div>}
  </>;
}

function CrownIcon() {
  return <span className="crown-mark"><Award size={22} /></span>;
}

function WatchlistPage() {
  const state = useLoad<Film[]>("watchlist");
  return <PageFrame wide><PageTitle eyebrow="YOUR LIBRARY" title="Saved for later." description="Your personal list of stories to come back to." />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}{state.loading ? <Loading /> : state.data?.length ? <div className="film-grid">{state.data.map((film) => <FilmCard key={film.id} film={film} />)}</div> : <EmptyState title="Your watchlist is waiting" message="Save films as you discover them and they'll be ready right here." href="/browse" />}</PageFrame>;
}

function ContinuePage() {
  const state = useLoad<ProgressItem[]>("progress");
  return <PageFrame wide><PageTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Continue watching." description="Your viewing progress, right where you left it." />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}
    {state.loading ? <Loading /> : state.data?.length ? <div className="progress-grid">{state.data.map((item) => <Link key={item.id} href={`/film/${item.film.id}`} className="progress-card"><div className="progress-image"><Poster film={item.film} /><span className="progress-bar"><i style={{ width: `${Math.min(100, item.percentComplete || 0)}%` }} /></span></div><div className="progress-card-info"><h3>{item.film.title}</h3><p><Clock3 size={14} />{formatDuration(Math.max(0, (item.totalSeconds || 0) - item.progressSeconds))} left</p></div></Link>)}</div> : <EmptyState title="Nothing in progress" message="Start watching a film and your place will be saved here." href="/browse" />}</PageFrame>;
}

function PlansPage() {
  const plansState = useLoad<Plan[]>("plans");
  const plans = plansState.data?.length ? plansState.data : [
    { id: 1, name: "Standard", priceMonthly: 599, features: ["Access to the ad-supported catalogue", "HD streaming", "Watch on 1 device"] },
    { id: 2, name: "Premiere", priceMonthly: 999, features: ["Full premium collection", "Ad-free viewing", "Watch on 4 devices", "Support African filmmakers"] },
  ];
  const [message, setMessage] = useState("");
  return <PageFrame><section className="page-hero compact centered"><p className="eyebrow">A LITTLE MORE CINEMA</p><h1>Choose your<br /><em>premiere.</em></h1><p>Discover more of the stories you love, while giving creators more room to tell them.</p></section>
    {plansState.error && <Notice message={plansState.error} onRetry={plansState.reload} />}
    <div className="plan-grid">{plans.map((plan, index) => <article className={`plan-card ${index === 1 ? "featured-plan" : ""}`} key={plan.id}>{index === 1 && <span className="plan-ribbon">MOST LOVED</span>}<span className="plan-icon">{index === 1 ? <Award size={22} /> : <FilmIcon size={22} />}</span><h2>{plan.name}</h2><p className="plan-price"><small>KES</small> {plan.priceMonthly.toLocaleString()}<span>/ month</span></p><ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul><button className={`button ${index === 1 ? "button-gold" : "button-glass"} button-block`} onClick={() => setMessage("Membership checkout isn't connected yet. Your plan selection has not been charged.")}>Choose {plan.name}<ArrowRight size={15} /></button></article>)}</div>
    <p className="fine-print">Plans are shown for preview. Payments and subscription management are not connected yet.</p>
    {message && <div className="toast-message" role="status">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
  </PageFrame>;
}

function ReelPage() {
  type ReelCategory = "Clips" | "Interviews" | "Podcasts" | "Marketing";
  type ReelSection = { title: string; description: string; items: [string, string, string, string, string][] };
  const [activeTab, setActiveTab] = useState<ReelCategory>("Clips");
  const categories: ReelCategory[] = ["Clips", "Interviews", "Podcasts", "Marketing"];
  const sections: Record<ReelCategory, ReelSection> = {
    Clips: {
      title: "Film clips & trailers",
      description: "Trailers, teasers, and memorable scenes from African cinema.",
      items: [
        ["Atlantics — Official Trailer", "Mati Diop's Cannes Grand Prix winner follows a young woman when her lover disappears at sea.", "2:24", "Trailer", "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=80"],
        ["Rafiki — Opening Scene", "Two girls meet in Nairobi in this tender, defiant love story by Wanuri Kahiu.", "4:12", "Clip", "https://images.unsplash.com/photo-1518729371765-043e78b00e31?w=900&q=80"],
        ["Pumzi — Short Film", "An Afrofuturist vision of a world 35 years after a global water war.", "21:00", "Full short", "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=900&q=80"],
        ["Sankofa — Teaser", "A photo shoot in Ghana sends a model on a journey through history.", "1:48", "Teaser", "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=900&q=80"],
        ["Nairobi Half Life — Fight Scene", "Mwas navigates the brutal streets of Nairobi in a story of survival and ambition.", "3:30", "Clip", "https://images.unsplash.com/photo-1516912481808-3406841bd33c?w=900&q=80"],
        ["Makala — Journey Into the City", "A Congolese charcoal maker walks hundreds of kilometres to sell his harvest.", "5:10", "Clip", "https://images.unsplash.com/photo-1551632436-cbf8dd35adfa?w=900&q=80"],
      ],
    },
    Interviews: {
      title: "Filmmaker interviews",
      description: "In-depth conversations with the directors and voices shaping African cinema.",
      items: [
        ["Wanuri Kahiu on Telling African Love Stories", "The Kenyan filmmaker on why African cinema needs to make room for joy.", "28:14", "Wanuri Kahiu · Director", "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=900&q=80"],
        ["Mati Diop: From Actress to Cannes Laureate", "A conversation on the supernatural realism behind Atlantics.", "34:52", "Mati Diop · Director", "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&q=80"],
        ["The Business of African Film", "A Ghanaian producer breaks down the economics of reaching global audiences.", "41:07", "Emmanuel Osei · Producer", "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900&q=80"],
        ["Chinonye Chukwu: Crafting Moral Cinema", "The Nigerian-American director discusses her Sundance Grand Jury Prize winner.", "26:30", "Chinonye Chukwu · Director", "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=900&q=80"],
      ],
    },
    Podcasts: {
      title: "Industry podcasts",
      description: "The conversations driving African cinema forward — festivals, business, craft, and culture.",
      items: [
        ["African Screen — The New Nollywood", "How streaming budgets and local storytelling are creating a new genre.", "1:02:14", "African Screen · Episode 42", "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=900&q=80"],
        ["Continent of Stories — Afrofuturism Now", "From Pumzi to Black Panther: African science fiction and speculative storytelling.", "58:44", "Continent of Stories · Episode 18", "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=900&q=80"],
        ["Reel Talk Africa — The Festival Circuit", "An insider guide to which African film festivals actually move careers.", "47:22", "Reel Talk Africa · Episode 31", "https://images.unsplash.com/photo-1614680376739-414d95ff43df?w=900&q=80"],
        ["Celluloid Griot — Women Behind the Camera", "Celebrating women directors, cinematographers, and editors reshaping the screen.", "1:14:08", "Celluloid Griot · Episode 7", "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=900&q=80"],
      ],
    },
    Marketing: {
      title: "Marketing & press",
      description: "Official brand films, campaign materials, and press resources.",
      items: [
        ["FilamuReel — Platform Launch Film", "What it means to bring African storytelling to a global stage.", "3:00", "Brand film", "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=900&q=80"],
        ["Creator Stories: Meet the Filmmakers", "Five filmmakers share why they chose FilamuReel to reach new audiences.", "4:45", "Campaign", "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=80"],
        ["African Voices — Season 1 Promo", "A curated celebration of debut features from across the continent.", "1:30", "Series promo", "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=900&q=80"],
      ],
    },
  };
  const current = sections[activeTab];
  return <PageFrame wide><section className="page-hero compact"><p className="eyebrow">THE REEL · BEYOND THE SCREEN</p><h1>African cinema,<br /><em>in conversation.</em></h1><p>Film clips, filmmaker interviews, industry podcasts and stories from the people shaping African cinema.</p></section>
    <div className="editorial-tabs" role="tablist" aria-label="Editorial categories">{categories.map((item) => <button role="tab" aria-selected={activeTab === item} className={activeTab === item ? "selected" : ""} key={item} onClick={() => setActiveTab(item)}>{item}</button>)}</div>
    <SectionHeading eyebrow="THE REEL" title={current.title} description={current.description} />
    <div className="editorial-grid">{current.items.map(([title, copy, duration, kind, image], index) => <article className={`editorial-card ${index === 0 ? "editorial-feature" : ""}`} key={title}><div className="editorial-image" style={{ backgroundImage: `linear-gradient(0deg, rgba(6,12,14,.72), transparent 65%), url("${image}")` }}><span className="editorial-kind"><Play size={12} fill="currentColor" />{kind}</span><span className="editorial-duration">{duration}</span></div><div className="editorial-copy"><p className="eyebrow">{activeTab.toUpperCase()}</p><h2>{title}</h2><p>{copy}</p></div></article>)}</div>
    <p className="fine-print">Editorial previews are currently image-and-description only; streaming media isn't connected yet.</p>
  </PageFrame>;
}

function CreatorLayout({ children }: { children: ReactNode }) {
  return <PageFrame wide><div className="creator-shell"><aside className="creator-sidebar"><p className="eyebrow">CREATOR STUDIO</p><nav><Link href="/creator"><LayoutDashboard size={16} />Overview</Link><Link href="/creator/films"><Clapperboard size={16} />My films</Link><Link href="/creator/upload"><Upload size={16} />New release</Link><Link href="/creator/analytics"><BarChart3 size={16} />Analytics</Link><Link href="/creator/earnings"><Wallet size={16} />Earnings</Link></nav><div className="creator-note"><FilmIcon size={17} /><span>Your stories.<br />Your audience.</span></div></aside><section className="creator-main">{children}</section></div></PageFrame>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-title-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function StatCard({ label, value, icon: Icon, note }: { label: string; value: string; icon: typeof Eye; note?: string }) {
  return <article className="stat-card"><span className="stat-icon"><Icon size={18} /></span><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

function CreatorDashboard() {
  const state = useLoad<Record<string, unknown>>("creator/dashboard");
  const data = state.data || {};
  const recentViews = Array.isArray(data.recentViews) ? data.recentViews as { date: string; views: number }[] : [];
  const topFilm = data.topFilm as Film | null;
  const maxViews = Math.max(1, ...recentViews.map((day) => Number(day.views || 0)));
  return <CreatorLayout><PageTitle eyebrow="CREATOR STUDIO" title="Welcome back." description="A look at how your stories are reaching the world." action={<Link href="/creator/upload" className="button button-gold"><Plus size={16} />New release</Link>} />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}
    {state.loading ? <Loading label="Preparing your studio…" /> : <>
      <div className="stat-grid"><StatCard label="Tracked views" value={Number(data.totalViews || 0).toLocaleString()} icon={Eye} note="Plays recorded on this platform" /><StatCard label="Earnings" value={data.earningsAvailable ? `KES ${Number(data.totalEarnings || 0).toLocaleString()}` : "Not connected"} icon={CircleDollarSign} /><StatCard label="Published films" value={String(data.publishedFilms || 0)} icon={Clapperboard} /><StatCard label="Payouts" value="Unavailable" icon={Wallet} /></div>
      <div className="dashboard-columns"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">YOUR AUDIENCE</p><h2>Views over time</h2></div><TrendingUp size={18} /></div>
        {recentViews.some((day) => day.views > 0) ? <div className="bar-chart">{recentViews.map((day) => <div className="bar-column" key={day.date} title={`${day.date}: ${day.views} plays`}><i style={{ height: `${Math.max(4, Number(day.views) / maxViews * 100)}%` }} /><small>{new Date(`${day.date}T00:00:00`).getDate()}</small></div>)}</div> : <div className="chart-placeholder"><BarChart3 size={23} /><span>Real viewing activity will appear here when audiences play your films.</span></div>}
      </article><article className="panel top-film-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR MOST WATCHED</p><h2>Top performing film</h2></div></div>{topFilm ? <Link href={`/film/${topFilm.id}`} className="top-film"><Poster film={topFilm} /><div><h3>{topFilm.title}</h3><p>{Number(topFilm.viewCount || 0).toLocaleString()} views</p></div></Link> : <EmptyState title="Your first premiere" message="Publish a film to start building your audience." href="/creator/upload" action="Add your first film" />}</article></div>
    </>}</CreatorLayout>;
}

function CreatorFilms() {
  const state = useLoad<Film[]>("creator/films");
  const [notice, setNotice] = useState("");
  const remove = async (film: Film) => {
    if (!window.confirm(`Delete “${film.title}”? This cannot be undone.`)) return;
    try { await api(`films/${film.id}`, { method: "DELETE" }); state.reload(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to delete film."); }
  };
  return <CreatorLayout><PageTitle eyebrow="YOUR PORTFOLIO" title="My films." description="Manage your releases and see how they are performing." action={<Link href="/creator/upload" className="button button-gold"><Plus size={16} />New release</Link>} />
    {notice && <Notice message={notice} />}{state.error && <Notice message={state.error} onRetry={state.reload} />}
    {state.loading ? <Loading /> : state.data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Film</th><th>Status</th><th>Access</th><th>Views</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{state.data.map((film) => <tr key={film.id}><td><Link href={`/film/${film.id}`} className="table-film"><Poster film={film} /><span><strong>{film.title}</strong><small>{film.category || film.genre || "Film"}</small></span></Link></td><td><span className="status-pill">{film.status || "Published"}</span></td><td className="capitalize">{film.monetization.replaceAll("_", " ")}</td><td>{Number(film.viewCount || 0).toLocaleString()}</td><td><button className="text-button danger" onClick={() => void remove(film)}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyState title="Your portfolio is empty" message="Bring your first story to FilamuReel and meet the people ready to see it." href="/creator/upload" action="Publish your first film" />}</CreatorLayout>;
}

function UploadFilm() {
  const categories = useLoad<Category[]>("categories");
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ title: "", description: "", category: "", genre: "", region: "", language: "", director: "", cast: "", duration: "", posterUrl: "", trailerUrl: "", videoUrl: "", monetization: "subscription", price: "" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const upload = async (key: "posterUrl" | "trailerUrl" | "videoUrl", file?: File) => {
    if (!file) return;
    const isPoster = key === "posterUrl";
    const limit = (isPoster ? 10 : 500) * 1024 * 1024;
    if (file.size > limit) {
      setError(`${isPoster ? "Poster images" : "Videos"} must be ${isPoster ? "10 MB" : "500 MB"} or smaller.`);
      return;
    }
    setError("");
    setUploading((state) => ({ ...state, [key]: true }));
    try {
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Upload failed (${response.status})`);
      }
      const result = await response.json() as { url: string };
      update(key, result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload this media file.");
    } finally {
      setUploading((state) => ({ ...state, [key]: false }));
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ""));
      await api("films", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          duration: form.duration ? Number(form.duration) * 60 : undefined,
          price: form.monetization === "pay_per_view" ? Number(form.price) : undefined,
          tags: [],
        }),
      });
      navigate("/creator/films");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to publish film."); }
    finally { setBusy(false); }
  };
  const field = (key: keyof typeof form, label: string, placeholder = "", type = "text") => <label className="form-field"><span>{label}</span><input type={type} required={["title", "category", "description"].includes(key)} min={type === "number" ? "0" : undefined} value={form[key]} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} /></label>;
  return <CreatorLayout><PageTitle eyebrow="CREATOR STUDIO / RELEASES" title="A new story." description="Add the details that will help your film find its audience." />
    {error && <Notice message={error} />}{categories.error && <Notice message={categories.error} onRetry={categories.reload} />}
    <form className="upload-form" onSubmit={submit}><section className="panel form-panel"><p className="eyebrow">THE FILM</p><div className="form-grid">{field("title", "Film title", "A title worth remembering")}<label className="form-field"><span>Category</span><select required value={form.category} onChange={(e) => update("category", e.target.value)}><option value="">Choose a category</option>{(categories.data || []).map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</select></label><label className="form-field full"><span>Synopsis</span><textarea rows={5} required minLength={10} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="What is the story you want to tell?" /></label>{field("genre", "Genre", "Drama, Documentary…")}{field("region", "Country / region", "Ghana")}{field("language", "Language", "English, Swahili…")}{field("director", "Director", "Director name")}{field("duration", "Runtime (minutes)", "e.g. 98", "number")}{field("cast", "Cast", "Names, separated by commas")}</div></section>
      <section className="panel form-panel"><p className="eyebrow">HOW IT'S SHARED</p><div className="form-grid"><label className="form-field"><span>Access model</span><select value={form.monetization} onChange={(e) => update("monetization", e.target.value)}><option value="subscription">Subscription</option><option value="free">Free</option><option value="ad_supported">Ad-supported</option><option value="pay_per_view">Pay per view</option></select></label>{form.monetization === "pay_per_view" && field("price", "Ticket price (KES)", "500", "number")}</div></section>
      <section className="panel form-panel"><p className="eyebrow">MEDIA ASSETS</p><div className="form-grid">
        {(["posterUrl", "trailerUrl", "videoUrl"] as const).map((key) => {
          const label = key === "posterUrl" ? "Poster image" : key === "trailerUrl" ? "Trailer" : "Full film";
          const accept = key === "posterUrl" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm,video/quicktime";
          return <div className="media-upload" key={key}>
            {field(key, `${label} URL`, "https://… or upload below")}
            <label className="file-picker"><span><Upload size={14} />{uploading[key] ? "Uploading…" : `Choose ${label.toLowerCase()} file`}</span><input type="file" accept={accept} disabled={uploading[key]} onChange={(event) => { void upload(key, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <small>{uploading[key] ? "Uploading and saving locally…" : form[key].startsWith("/uploads/") ? "Uploaded to this server." : key === "posterUrl" ? "JPEG, PNG, WebP · max 10 MB" : "MP4, WebM, QuickTime · max 500 MB"}</small>
          </div>;
        })}
      </div><p className="form-hint">Uploaded files are stored locally in the Reel server's uploads folder.</p></section>
      <div className="form-actions"><Link href="/creator/films" className="button button-glass">Cancel</Link><button className="button button-gold" disabled={busy || Object.values(uploading).some(Boolean)}><Upload size={15} />{busy ? "Publishing…" : "Publish film"}</button></div>
    </form>
  </CreatorLayout>;
}

function CreatorAnalytics() {
  const state = useLoad<Record<string, unknown>>("creator/analytics");
  const data = state.data || {};
  const byDay = Array.isArray(data.viewsByDay) ? data.viewsByDay as { date: string; views: number }[] : [];
  const regions = Array.isArray(data.topRegions) ? data.topRegions as { name: string; value: number }[] : [];
  const max = Math.max(1, ...byDay.map((item) => Number(item.views || 0)));
  return <CreatorLayout><PageTitle eyebrow="CREATOR STUDIO" title="Know your audience." description="A clearer picture of who's spending time with your stories." />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}{state.loading ? <Loading label="Loading your audience data…" /> : <>
      <div className="stat-grid four"><StatCard label="Total watch time" value={`${Math.floor(Number(data.totalWatchTime || 0) / 60)} hrs`} icon={Clock3} /><StatCard label="Avg. completion" value={`${Number(data.avgWatchThroughRate || 0)}%`} icon={TrendingUp} /><StatCard label="Average rating" value={Number(data.avgRating || 0).toFixed(1)} icon={Star} /><StatCard label="Total views" value={Number(data.totalViews || 0).toLocaleString()} icon={Eye} /></div>
      <div className="dashboard-columns"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">LAST 30 DAYS</p><h2>Film engagement</h2></div></div>{byDay.some((item) => item.views > 0) ? <div className="bar-chart large">{byDay.map((item) => <div className="bar-column" key={item.date} title={`${item.date}: ${item.views} plays`}><i style={{ height: `${Math.max(4, Number(item.views) / max * 100)}%` }} /><small>{new Date(`${item.date}T00:00:00`).getDate()}</small></div>)}</div> : <div className="chart-placeholder"><BarChart3 size={22} />Real viewing activity will appear here when audiences play your films.</div>}</article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">WHERE THEY WATCH</p><h2>Top regions</h2></div><Globe2 size={18} /></div>{regions.length ? <div className="region-list">{regions.map((item, index) => <div className="region-row" key={item.name}><span className="region-rank">0{index + 1}</span><span>{item.name}</span><strong>{item.value}%</strong></div>)}</div> : <div className="chart-placeholder">Audience regions will be shown when viewing data is available.</div>}</article></div>
    </>}</CreatorLayout>;
}

function CreatorEarnings() {
  const state = useLoad<Record<string, unknown>>("creator/earnings");
  const data = state.data || {};
  const history = Array.isArray(data.withdrawals) ? data.withdrawals as { id: number; amount: number; method: string; status: string; createdAt: string }[] : [];
  return <CreatorLayout><PageTitle eyebrow="CREATOR STUDIO" title="Earnings & payouts." description="Revenue reporting will be available once platform payments are connected." action={<button className="button button-glass" disabled title="Payouts are not configured"><Wallet size={15} />Payouts unavailable</button>} />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}
    {state.loading ? <Loading label="Loading earnings…" /> : <>
      <div className="stat-grid three"><StatCard label="Available balance" value="Unavailable" icon={Wallet} /><StatCard label="Pending clearing" value="Unavailable" icon={Clock3} /><StatCard label="Total earned" value="Unavailable" icon={CircleDollarSign} /></div>
      <section className="panel revenue-panel"><div className="panel-heading"><div><p className="eyebrow">REVENUE SOURCES</p><h2>Not connected yet</h2></div></div><p className="muted panel-empty">Views and watch time are tracked from real playback events. Subscription charges, ticket purchases, advertising settlements, and creator payouts are not connected, so no earnings are estimated or displayed.</p></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PAYOUT ACTIVITY</p><h2>Recent withdrawals</h2></div></div>{history.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleDateString()}</td><td className="capitalize">{item.method.replaceAll("_", " ")}</td><td>KES {Number(item.amount).toLocaleString()}</td><td><span className="status-pill">{item.status}</span></td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No payout activity. Payout requests are disabled until settlement processing is connected.</p>}</section>
    </>}</CreatorLayout>;
}

function NotFound() {
  return <PageFrame><div className="not-found"><p className="eyebrow">OUT OF FRAME</p><h1>We lost the story.</h1><p className="muted">The page you’re looking for is no longer on this reel.</p><Link href="/" className="button button-gold"><ArrowLeft size={15} />Back to home</Link></div></PageFrame>;
}

export default App;
