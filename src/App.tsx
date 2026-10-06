import { createContext, useContext, useEffect, useRef, useState, type AnchorHTMLAttributes, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Award, BarChart3, Bookmark,
  Check, ChevronLeft, ChevronRight, CircleDollarSign, Clapperboard, Clock3, Compass,
  Download, Film as FilmIcon, FastForward, Flame, Globe2, Grid2X2, Heart, House, LayoutDashboard, LoaderCircle, Maximize, Menu, MessageCircle,
  Pause, Play, Plus, Rewind, Search, Send, Settings2, Share2, Smartphone, Star, Ticket, ThumbsUp, TrendingUp, Trophy, Upload, Volume2,
  VolumeX, Wallet, X, Eye, Users, ShieldCheck, CreditCard, ClipboardList, LogOut, Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, formatDuration, type Category, type Film, type FilmList, type Plan, type ProgressItem, type Review } from "./api";
import "./index.css";

type Router = { path: string; navigate: (to: string) => void };
const RouterContext = createContext<Router>({ path: "/", navigate: () => undefined });
type AccountUser = { id: number; name: string; email: string; role: "audience" | "creator" | "admin"; status: string; isDemo: boolean };
type AuthState = { user: AccountUser | null; loading: boolean; refresh: () => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthState>({ user: null, loading: true, refresh: async () => undefined, signOut: async () => undefined });
type BrowserInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type UploadStatus = { name: string; size: number; progress: number; status: "uploading" | "complete" | "failed" };

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function uploadFile(file: File, onProgress: (percent: number) => void) {
  return new Promise<{ url: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/uploads");
    request.setRequestHeader("Content-Type", file.type);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    });
    request.addEventListener("load", () => {
      let payload: { url?: string; error?: string } = {};
      try { payload = JSON.parse(request.responseText) as typeof payload; }
      catch { /* The status below reports invalid or unsuccessful server responses. */ }
      if (request.status >= 200 && request.status < 300 && payload.url) resolve({ url: payload.url });
      else reject(new Error(payload.error || `Upload failed (${request.status || "network error"})`));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed. Check your connection and try again.")));
    request.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));
    request.send(file);
  });
}

function CreatorWizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return <ol className="creator-wizard-steps" aria-label="Upload steps">{steps.map((step, index) =>
    <li key={step} className={index === current ? "current" : index < current ? "complete" : ""} aria-current={index === current ? "step" : undefined}>
      <span>{index < current ? <Check size={13} /> : index + 1}</span><small>{step}</small>
    </li>)}</ol>;
}

function UploadFileStatus({ upload }: { upload: UploadStatus }) {
  return <div className={`upload-file-status ${upload.status}`} aria-live="polite">
    <div className="upload-file-details"><strong>{upload.name}</strong><span>{formatFileSize(upload.size)} · {upload.status === "complete" ? "Uploaded" : upload.status === "failed" ? "Upload failed" : `Uploading ${upload.progress}%`}</span></div>
    <div className="upload-progress-track" role="progressbar" aria-label={`Uploading ${upload.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.progress}><i style={{ width: `${upload.progress}%` }} /></div>
  </div>;
}

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
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    if (!path) {
      setLoading(false);
      setData(null);
      setDataPath(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    api<T>(path).then((result) => {
      if (active) {
        setData(result);
        setDataPath(path);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Unable to load this page.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, version]);
  return { data: dataPath === path ? data : null, error, loading, reload: () => setVersion((current) => current + 1) };
}

function useRouter() {
  return useContext(RouterContext);
}

function RequireAccount({ children }: { children: ReactNode }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <PageFrame><Loading label="Checking your account…" /></PageFrame>;
  if (!user) return <PageFrame><EmptyState title="Sign in to continue" message="Sign in or create an account to access your personal library." href="/account" action="Sign in or create account" /></PageFrame>;
  return children;
}

function RequireRole({ role, children }: { role: "creator"; children: ReactNode }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <PageFrame><Loading label="Checking your account…" /></PageFrame>;
  if (!user) return <PageFrame><EmptyState title="Creator account required" message="Sign in with a creator account or create one to open Creator Studio." href="/account" action="Create or sign in" /></PageFrame>;
  if (user.role !== role) return <PageFrame><EmptyState title="Creator account required" message="This area is only available to creator accounts." href="/account" action="View your account" /></PageFrame>;
  return children;
}

export function App() {
  const [path, setPath] = useState(() => `${window.location.pathname}${window.location.search}`);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const pwaInstall = usePwaInstall();
  const refreshAuth = async () => {
    const result = await api<{ user: AccountUser | null }>("auth/me");
    setUser(result.user);
    setAuthLoading(false);
  };
  const signOut = async () => {
    await api("auth/logout", { method: "POST" });
    setUser(null);
  };
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
  useEffect(() => {
    void refreshAuth().catch(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js")
      .catch((error: unknown) => console.error("Unable to register the FilamuReel service worker.", error));
  }, []);
  const route = path.split("?")[0] || "/";
  let page: ReactNode;
  if (route === "/") page = <Home />;
  else if (route === "/browse") page = <Browse />;
  else if (route.startsWith("/film/")) page = <FilmDetail id={route.split("/")[2] || ""} />;
  else if (route === "/watchlist") page = <RequireAccount><WatchlistPage /></RequireAccount>;
  else if (route === "/continue-watching") page = <RequireAccount><ContinuePage /></RequireAccount>;
  else if (route === "/plans") page = <PlansPage />;
  else if (route === "/reel") page = <ReelPage />;
  else if (route === "/account") page = <AccountPage />;
  else if (route === "/admin") page = <AdminDashboard />;
  else if (route === "/creator" || route === "/creator/") page = <RequireRole role="creator"><CreatorDashboard /></RequireRole>;
  else if (route === "/creator/films") page = <RequireRole role="creator"><CreatorFilms /></RequireRole>;
  else if (route === "/creator/reel") page = <RequireRole role="creator"><CreatorReel /></RequireRole>;
  else if (route === "/creator/upload") page = <RequireRole role="creator"><UploadFilm /></RequireRole>;
  else if (route === "/creator/analytics") page = <RequireRole role="creator"><CreatorAnalytics /></RequireRole>;
  else if (route === "/creator/earnings") page = <RequireRole role="creator"><CreatorEarnings /></RequireRole>;
  else page = <NotFound />;

  return <RouterContext.Provider value={{ path, navigate }}>
    <AuthContext.Provider value={{ user, loading: authLoading, refresh: refreshAuth, signOut }}>
    <div className="app-shell"><Header pwaInstall={pwaInstall} />{page}<Footer /><PwaInstallPrompt pwaInstall={pwaInstall} /></div>
    </AuthContext.Provider>
  </RouterContext.Provider>;
}

function Header({ pwaInstall }: { pwaInstall: PwaInstallState }) {
  const { path } = useRouter();
  const { user, signOut } = useContext(AuthContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const creator = path.startsWith("/creator");
  const admin = path.startsWith("/admin");
  const nav = admin
    ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }]
    : creator
    ? [{ to: "/creator", label: "Overview", icon: LayoutDashboard }, { to: "/creator/films", label: "My films", icon: Clapperboard }, { to: "/creator/reel", label: "Reel uploads", icon: Play }, { to: "/creator/analytics", label: "Analytics", icon: BarChart3 }, { to: "/creator/earnings", label: "Earnings", icon: Wallet }]
    : [{ to: "/", label: "Home", icon: House }, { to: "/browse", label: "Explore", icon: Compass }, { to: "/reel", label: "The Reel", icon: FilmIcon }, { to: "/watchlist", label: "Watchlist", icon: Bookmark }];
  return <header className="site-header">
    <div className="nav-wrap">
      <Link href="/" className="brand"><span className="brand-mark"><FilmIcon size={19} /></span><span>Filamu<span className="brand-accent">Reel</span></span></Link>
      <nav className={`main-nav ${menuOpen ? "nav-open" : ""}`}>
        {nav.map(({ to, label, icon: Icon }) => <Link key={to} href={to} className={`nav-link ${path.split("?")[0] === to ? "active" : ""}`} onClick={() => setMenuOpen(false)}><Icon size={16} />{label}</Link>)}
        {menuOpen && pwaInstall.showOptions && <InstallCard pwaInstall={pwaInstall} compact />}
      </nav>
      <div className="nav-actions">
        {!creator && !admin && <Link href="/plans" className="button button-outline button-small"><Ticket size={15} /> Membership</Link>}
        {!admin && user?.role === "creator" && <Link href={creator ? "/" : "/creator"} className="studio-link">{creator ? "Exit Studio" : "Creator studio"}<ArrowUpRight size={15} /></Link>}
        {user?.role === "admin" && <Link href="/admin" className="studio-link"><ShieldCheck size={15} />Admin</Link>}
        <Link href="/account" className="studio-link">{user ? user.name : "Sign in"}</Link>
        {user && <button className="studio-link header-signout" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={15} /></button>}
        <button className="icon-button menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </div>
  </header>;
}

function Footer() {
  return <footer className="site-footer"><Link href="/" className="brand"><span className="brand-mark"><FilmIcon size={17} /></span><span>Filamu<span className="brand-accent">Reel</span></span></Link><p>A home for stories born across Africa.</p><span className="footer-copy">© {new Date().getFullYear()} FilamuReel</span></footer>;
}

type PwaInstallState = {
  installPrompt: BrowserInstallPrompt | null;
  showOptions: boolean;
  showBanner: boolean;
  iosInstall: boolean;
  installed: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
};

function usePwaInstall(): PwaInstallState {
  const [installPrompt, setInstallPrompt] = useState<BrowserInstallPrompt | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [iosInstall, setIosInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const alreadyInstalled = displayMode.matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const dismissed = localStorage.getItem("filamureel-install-dismissed-v1") === "true";
    if (alreadyInstalled) {
      setInstalled(true);
      return;
    }
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    let timer: number | undefined;
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BrowserInstallPrompt);
      timer = window.setTimeout(() => {
        setShowOptions(true);
        if (!dismissed) setShowBanner(true);
      }, 7000);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setShowOptions(false);
      setShowBanner(false);
      setInstallPrompt(null);
    };
    if (isIos) {
      setIosInstall(true);
      timer = window.setTimeout(() => {
        setShowOptions(true);
        if (!dismissed) setShowBanner(true);
      }, 7000);
    }
    const onDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches) onAppInstalled();
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);
  const dismiss = () => {
    localStorage.setItem("filamureel-install-dismissed-v1", "true");
    setShowBanner(false);
  };
  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setShowBanner(false);
      setShowOptions(false);
    }
  };
  return { installPrompt, showOptions, showBanner: showBanner && !installed, iosInstall, installed, install, dismiss };
}

function InstallCard({ pwaInstall, compact = false }: { pwaInstall: PwaInstallState; compact?: boolean }) {
  return <aside className={`pwa-install-card ${compact ? "compact" : ""}`} aria-label="Install FilamuReel">
    <div className="pwa-install-card-brand"><img src="/icons/reel.svg" alt="" width="38" height="38" /><span><strong>Take Reel with you</strong><small>Install FilamuReel for quick access.</small></span></div>
    {pwaInstall.installPrompt
      ? <button className="button button-gold pwa-install-action" onClick={() => void pwaInstall.install()}><Download size={15} />Install app</button>
      : pwaInstall.iosInstall
        ? <div className="pwa-ios-steps"><span>1</span><Share2 size={15} /><strong>Share</strong><ArrowRight size={13} /><span>2</span><strong>Add to Home Screen</strong></div>
        : <p className="pwa-install-manual">Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong> from your browser menu.</p>}
  </aside>;
}

function PwaInstallPrompt({ pwaInstall }: { pwaInstall: PwaInstallState }) {
  if (!pwaInstall.showBanner || (!pwaInstall.installPrompt && !pwaInstall.iosInstall)) return null;
  return <aside className="pwa-install-banner" aria-label="Install FilamuReel">
    <div className="pwa-install-topline"><span className="pwa-install-icon"><img src="/icons/reel.svg" alt="" width="52" height="52" /></span><span className="eyebrow">FILAMUREEL · YOUR CINEMA</span><button className="pwa-install-dismiss" onClick={pwaInstall.dismiss} aria-label="Dismiss install prompt"><X size={17} /></button></div>
    <div className="pwa-install-copy"><strong>Your cinema,<br />one tap away.</strong><span>{pwaInstall.iosInstall && !pwaInstall.installPrompt ? "Add FilamuReel to your Home Screen for a focused, app-like experience." : "Install FilamuReel for quick access to stories from across Africa."}</span></div>
    {pwaInstall.installPrompt
      ? <button className="button button-gold pwa-install-action" onClick={() => void pwaInstall.install()}><Download size={15} />Install FilamuReel</button>
      : pwaInstall.iosInstall && <div className="pwa-ios-steps"><span>1</span><Share2 size={15} /><strong>Share</strong><ArrowRight size={13} /><span>2</span><strong>Add to Home Screen</strong></div>}
  </aside>;
}

function PageFrame({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <main className={`page-content ${wide ? "wide" : ""} ${className}`}>{children}</main>;
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
  const railRef = useRef<HTMLDivElement>(null);
  if (!films.length) return null;
  const move = (step: number) => {
    const rail = railRef.current;
    if (rail) rail.scrollBy({ left: step * rail.clientWidth * 0.8, behavior: "smooth" });
  };
  return <section className="film-rail">
    <SectionHeading eyebrow={eyebrow} title={title} action={<div className="rail-controls"><button className="icon-button" aria-label="Scroll left" onClick={() => move(-3)}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Scroll right" onClick={() => move(3)}><ChevronRight size={18} /></button></div>} />
    <div className="rail-window" ref={railRef}><div className="rail-track">{films.map((film) => <FilmCard key={film.id} film={film} />)}</div></div>
  </section>;
}

function Home() {
  const { user } = useContext(AuthContext);
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
      <div className="creator-callout"><div><p className="eyebrow">YOUR STORY BELONGS HERE</p><h2>Make room for a new voice.</h2><p>Bring your film to an audience that values the stories you have to tell.</p><Link href={user?.role === "creator" ? "/creator" : "/account"} className="button button-gold">{user?.role === "creator" ? "Enter creator studio" : "Create a creator account"}<ArrowRight size={16} /></Link></div><div className="callout-art"><span>F</span><span>R</span></div></div>
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

function playerTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

function VideoPlayer({ film, initialPosition, onClose, onSaveError }: {
  film: Film;
  initialPosition: number;
  onClose: () => void;
  onSaveError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const viewingEventId = useRef<number | null>(null);
  const viewingEventRequest = useRef<Promise<number> | null>(null);
  const progressQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingPosition = useRef(initialPosition);
  const lastCheckpoint = useRef(initialPosition);
  const lastMediaTime = useRef(initialPosition);
  const watchedSeconds = useRef(0);
  const continuousPlaySeconds = useRef(0);
  const hasPlayed = useRef(false);
  const playingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(film.duration || 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerError, setPlayerError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [watchPromptOpen, setWatchPromptOpen] = useState(false);
  const sourceType = film.videoUrl ? "film" : "trailer";
  const source = film.videoUrl || film.trailerUrl || undefined;

  const beginViewingEvent = () => {
    if (viewingEventId.current !== null) return Promise.resolve(viewingEventId.current);
    if (viewingEventRequest.current) return viewingEventRequest.current;
    viewingEventRequest.current = api<{ viewingEventId: number }>(`films/${film.id}/view`, {
      method: "POST",
      body: JSON.stringify({ mediaType: sourceType }),
    }).then(({ viewingEventId: id }) => {
      viewingEventId.current = id;
      return id;
    }).finally(() => { viewingEventRequest.current = null; });
    return viewingEventRequest.current;
  };

  const saveProgress = (position: number, total: number, keepalive = false, reportError = false) => {
    const watched = Math.min(30, Math.floor(watchedSeconds.current));
    watchedSeconds.current = Math.max(0, watchedSeconds.current - watched);
    const task = progressQueue.current.catch(() => undefined).then(async () => {
      let eventId = viewingEventId.current;
      if (hasPlayed.current && eventId === null && !keepalive) {
        try { eventId = await beginViewingEvent(); }
        catch { /* Progress is still saved if event tracking is unavailable. */ }
      }
      const body = {
        filmId: film.id,
        progressSeconds: Math.max(0, Math.floor(position)),
        totalSeconds: Math.max(0, Math.floor(total)),
        watchedSecondsDelta: watched,
        ...(eventId === null ? {} : { viewingEventId: eventId }),
      };
      let failure: unknown;
      for (let attempt = 0; attempt < (keepalive ? 1 : 3); attempt++) {
        try {
          await api("progress", { method: "POST", body: JSON.stringify(body), keepalive });
          setSaveError("");
          return;
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      throw failure;
    });
    progressQueue.current = task;
    return task.catch((error: unknown) => {
      watchedSeconds.current += watched;
      const message = error instanceof Error ? error.message : "Unable to save viewing progress.";
      setSaveError(message);
      if (keepalive || reportError) onSaveError(message);
    });
  };

  const closePlayer = async () => {
    const video = videoRef.current;
    if (video && hasPlayed.current) {
      try { await saveProgress(video.currentTime, video.duration || film.duration || 0, false, true); }
      catch { /* saveProgress reports the error and the player can still close. */ }
    }
    onClose();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const saveOnExit = () => {
      if (hasPlayed.current)
        void saveProgress(video.currentTime, video.duration || film.duration || 0, true);
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveOnExit();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    window.addEventListener("pagehide", saveOnExit);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      window.removeEventListener("pagehide", saveOnExit);
    };
  }, [film.duration, film.id]);

  useEffect(() => {
    const syncFullscreen = () => {
      const fullscreen = document.fullscreenElement === playerRef.current;
      setIsFullscreen(fullscreen);
      setControlsVisible(true);
      if (!fullscreen) screen.orientation?.unlock();
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isFullscreen || !playing || buffering || loading || playerError || watchPromptOpen) {
      setControlsVisible(true);
      return;
    }
    let hideTimer = 0;
    const revealControls = () => {
      setControlsVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setControlsVisible(false), 2500);
    };
    player.addEventListener("pointermove", revealControls);
    player.addEventListener("pointerdown", revealControls);
    player.addEventListener("keydown", revealControls);
    hideTimer = window.setTimeout(() => setControlsVisible(false), 2500);
    return () => {
      window.clearTimeout(hideTimer);
      player.removeEventListener("pointermove", revealControls);
      player.removeEventListener("pointerdown", revealControls);
      player.removeEventListener("keydown", revealControls);
    };
  }, [buffering, isFullscreen, loading, playerError, playing, watchPromptOpen]);

  useEffect(() => {
    if (!playing || buffering || watchPromptOpen) return;
    const timer = window.setInterval(() => {
      continuousPlaySeconds.current += 1;
      if (continuousPlaySeconds.current >= 3 * 60 * 60) {
        continuousPlaySeconds.current = 0;
        setWatchPromptOpen(true);
        videoRef.current?.pause();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [buffering, playing, watchPromptOpen]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch((error: unknown) => {
        setPlayerError(error instanceof Error ? error.message : "Playback could not start.");
      });
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) {
        video.volume = 0.5;
        setVolume(0.5);
      }
      video.muted = false;
    } else {
      video.muted = true;
    }
    setMuted(video.muted);
  };

  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const end = Number.isFinite(video.duration) ? video.duration : Math.max(0, duration);
    video.currentTime = Math.max(0, Math.min(end, video.currentTime + seconds));
    setCurrentTime(video.currentTime);
    lastMediaTime.current = video.currentTime;
  };

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setSettingsOpen(false);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      screen.orientation?.unlock();
    } else if (playerRef.current) {
      void playerRef.current.requestFullscreen().then(() => {
        if (screen.orientation?.lock)
          void screen.orientation.lock("landscape").catch((error: unknown) => {
            console.warn("The browser did not allow landscape orientation lock.", error);
          });
      }).catch((error: unknown) => {
        setPlayerError(error instanceof Error ? error.message : "Fullscreen is unavailable in this browser.");
      });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void closePlayer();
    } else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      togglePlayback();
    } else if (event.key.toLowerCase() === "m") {
      toggleMute();
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  };

  const onTimeUpdate = (video: HTMLVideoElement) => {
    const now = video.currentTime;
    const delta = now - lastMediaTime.current;
    if (playingRef.current && delta > 0 && delta <= 5)
      watchedSeconds.current += delta;
    lastMediaTime.current = now;
    setCurrentTime(now);
    if (now - lastCheckpoint.current >= 15) {
      lastCheckpoint.current = now;
      void saveProgress(now, video.duration || film.duration || 0);
    }
  };

  return <div className="modal-backdrop player-backdrop" role="presentation" onClick={(event) => {
    if (event.target === event.currentTarget) void closePlayer();
  }}><div className={`video-modal${isFullscreen && playing && !controlsVisible && !buffering && !loading && !playerError && !watchPromptOpen ? " controls-hidden" : ""}`} ref={playerRef} role="dialog" aria-modal="true" aria-label={`Watch ${film.title}`} tabIndex={-1} onKeyDown={handleKeyDown}>
    <div className="player-heading player-chrome">
      <div><span className="player-brand-mark"><FilmIcon size={17} /></span><span><strong>Filamu<span>Reel</span></strong><small>{film.title}</small></span></div>
      <button className="player-close" autoFocus onClick={() => void closePlayer()} aria-label="Close player"><X size={20} /></button>
    </div>
    <div className="player-stage">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        preload="auto"
        poster={film.posterUrl || undefined}
        src={source}
        aria-label={film.title}
        onClick={() => {
          if (isFullscreen && playing) {
            setControlsVisible(true);
          } else if (!loading && !buffering && !playerError) {
            togglePlayback();
          }
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const actualDuration = Number.isFinite(video.duration) ? video.duration : film.duration || 0;
          setDuration(actualDuration);
          const startAt = Math.min(pendingPosition.current, Math.max(0, actualDuration - 1));
          video.currentTime = startAt;
          setCurrentTime(startAt);
          lastCheckpoint.current = startAt;
          lastMediaTime.current = startAt;
        }}
        onCanPlay={() => { setLoading(false); setBuffering(false); }}
        onWaiting={() => { setLoading(false); setBuffering(true); }}
        onPlaying={() => {
          setLoading(false);
          setBuffering(false);
          setPlayerError("");
          setPlaying(true);
          playingRef.current = true;
          hasPlayed.current = true;
          lastMediaTime.current = videoRef.current?.currentTime || 0;
          void beginViewingEvent().catch((error: unknown) => {
            setSaveError(error instanceof Error ? error.message : "Unable to record this playback.");
          });
        }}
        onPause={(event) => {
          setPlaying(false);
          playingRef.current = false;
          if (!watchPromptOpen) continuousPlaySeconds.current = 0;
          if (hasPlayed.current)
            void saveProgress(event.currentTarget.currentTime, event.currentTarget.duration || film.duration || 0);
        }}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget)}
        onSeeking={(event) => { lastMediaTime.current = event.currentTarget.currentTime; }}
        onSeeked={(event) => { lastMediaTime.current = event.currentTarget.currentTime; }}
        onEnded={(event) => {
          setPlaying(false);
          playingRef.current = false;
          const video = event.currentTarget;
          lastCheckpoint.current = video.currentTime;
          void saveProgress(video.currentTime, video.duration || film.duration || 0);
        }}
        onError={() => {
          setLoading(false);
          setBuffering(false);
          setPlayerError("This video could not be loaded. Check your connection and try again.");
        }}
      />
      {(loading || buffering) && <div className="player-loading" role="status" aria-live="polite">
        <span className="player-loader-mark"><FilmIcon size={25} /></span>
        <strong>Filamu<span>Reel</span></strong>
        <small>{buffering ? "Buffering film…" : "Loading film…"}</small>
      </div>}
      {playerError && <div className="player-error" role="alert"><p>{playerError}</p><button className="button button-outline button-small" onClick={() => { setPlayerError(""); setLoading(true); videoRef.current?.load(); }}>Try again</button></div>}
      {!playing && !loading && !buffering && !playerError && <button className="player-center-play" onClick={togglePlayback} aria-label="Play"><Play size={28} fill="currentColor" /></button>}
    </div>
    <div className="player-controls player-chrome">
      {saveError && <div className="player-save-error" role="status">{saveError}<button onClick={() => { const video = videoRef.current; if (video) void saveProgress(video.currentTime, video.duration || film.duration || 0); }}>Retry save</button></div>}
      <div className="player-timeline">
        <input aria-label="Seek film" type="range" min="0" max={duration || 0} step="1" value={Math.min(currentTime, duration || 0)} style={{ "--player-progress": `${duration ? currentTime / duration * 100 : 0}%` } as React.CSSProperties} onChange={(event) => {
          const video = videoRef.current;
          if (!video) return;
          video.currentTime = Number(event.target.value);
          setCurrentTime(video.currentTime);
          lastMediaTime.current = video.currentTime;
        }} />
      </div>
      <div className="player-control-row">
        <div className="player-control-group">
          <button className="player-control-button" onClick={togglePlayback} aria-label={playing ? "Pause film" : "Play film"}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
          <button className="player-control-button" onClick={() => seekBy(-10)} aria-label="Rewind 10 seconds" title="Rewind 10 seconds"><Rewind size={17} /><small>10</small></button>
          <button className="player-control-button" onClick={() => seekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds"><FastForward size={17} /><small>10</small></button>
          <span className="player-clock">{playerTime(currentTime)} <i>/</i> {playerTime(duration)}</span>
        </div>
        <div className="player-control-group">
          <button className="player-control-button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
          <input className="player-volume" aria-label="Volume" type="range" min="0" max="1" step=".05" value={muted ? 0 : volume} style={{ "--volume-level": `${muted ? 0 : volume * 100}%` } as React.CSSProperties} onChange={(event) => {
            const nextVolume = Number(event.target.value);
            setVolume(nextVolume);
            setMuted(nextVolume === 0);
            if (videoRef.current) {
              videoRef.current.volume = nextVolume;
              videoRef.current.muted = nextVolume === 0;
            }
          }} />
          <div className="player-settings">
            <button className="player-control-button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Playback settings" aria-expanded={settingsOpen} aria-haspopup="menu" title="Playback settings"><Settings2 size={18} /></button>
            {settingsOpen && <div className="player-settings-menu" role="menu" aria-label="Playback speed">
              <strong>Playback speed</strong>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <button key={rate} role="menuitemradio" aria-checked={playbackRate === rate} className={playbackRate === rate ? "selected" : ""} onClick={() => changePlaybackRate(rate)}>{rate === 1 ? "Normal" : `${rate}×`}</button>)}
            </div>}
          </div>
          <button className="player-control-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><Maximize size={18} /></button>
        </div>
      </div>
    </div>
    {watchPromptOpen && <div className="player-attention-backdrop"><section className="player-attention-dialog" role="alertdialog" aria-modal="true" aria-labelledby="watch-prompt-title" aria-describedby="watch-prompt-description">
      <span className="player-brand-mark"><FilmIcon size={20} /></span><p className="eyebrow">A MOMENT FOR THE AUDIENCE</p><h2 id="watch-prompt-title">Are you still watching?</h2>
      <p id="watch-prompt-description">Playback paused after three hours. Take a break or pick up where you left off.</p>
      <div className="resume-actions">
        <button className="button button-gold" autoFocus onClick={() => {
          continuousPlaySeconds.current = 0;
          setWatchPromptOpen(false);
          togglePlayback();
        }}><Play size={15} fill="currentColor" />Continue watching</button>
        <button className="button button-glass" onClick={() => void closePlayer()}>Close player</button>
      </div>
    </section></div>}
  </div></div>;
}

function FilmDetail({ id }: { id: string }) {
  const { user } = useContext(AuthContext);
  const { navigate } = useRouter();
  const filmId = Number(id);
  const filmState = useLoad<Film>(Number.isInteger(filmId) ? `films/${filmId}` : null);
  const related = useLoad<Film[]>(Number.isInteger(filmId) ? `films/${filmId}/related` : null);
  const reviewsState = useLoad<Review[]>(Number.isInteger(filmId) ? `films/${filmId}/reviews` : null);
  const [mutationError, setMutationError] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [resumePromptOpen, setResumePromptOpen] = useState(false);
  const [initialPosition, setInitialPosition] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const film = filmState.data;
  const toggleWatchlist = async () => {
    if (!user) { navigate("/account"); return; }
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
    if (!user) { navigate("/account"); setBusy(false); return; }
    try {
      await api(`films/${filmId}/reviews`, { method: "POST", body: JSON.stringify({ rating, comment }) });
      setComment(""); setReviewOpen(false); reviewsState.reload(); filmState.reload();
    } catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to submit review."); }
    finally { setBusy(false); }
  };
  const startPlayback = async () => {
    if (!user) { navigate("/account"); return; }
    if (!film) return;
    if (!film.videoUrl && !film.trailerUrl) {
      setMutationError("A video has not been uploaded or linked for this film yet.");
      return;
    }
    const position = film.watchProgress || 0;
    const total = film.duration || 0;
    if (position >= 10 && (!total || position / total < 0.95)) {
      setResumePromptOpen(true);
    } else {
      void selectPlaybackPosition(false);
    }
  };
  const selectPlaybackPosition = async (resume: boolean) => {
    if (!film) return;
    setBusy(true);
    setMutationError("");
    try {
      const position = resume ? film.watchProgress || 0 : 0;
      if (!resume && (film.watchProgress || 0) > 0) {
        await api("progress", {
          method: "POST",
          body: JSON.stringify({
            filmId: film.id,
            progressSeconds: 0,
            totalSeconds: film.duration || 0,
          }),
        });
      }
      setInitialPosition(position);
      setResumePromptOpen(false);
      setVideoOpen(true);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Unable to reset viewing progress.");
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
          <div className="hero-actions"><button className="button button-gold" onClick={() => void startPlayback()} disabled={busy}><Play size={16} fill="currentColor" />{film.watchProgress && film.watchProgress >= 10 && (!film.duration || film.watchProgress / film.duration < 0.95) ? "Resume film" : film.watchProgress && film.watchProgress >= 10 ? "Watch again" : "Play film"}</button>
            <button className="button button-glass" onClick={toggleWatchlist} disabled={busy}>{film.isInWatchlist ? <Check size={16} /> : <Plus size={16} />}{film.isInWatchlist ? "Saved to watchlist" : "Add to watchlist"}</button>
            <button className="icon-button share-button" onClick={() => navigator.clipboard.writeText(location.href).then(() => setMutationError("Link copied to clipboard.")).catch(() => setMutationError("Unable to copy link in this browser."))} aria-label="Copy film link"><Share2 size={17} /></button>
          </div>
        </div>
      </div>
    </section>
    <PageFrame wide><div className="detail-columns"><div>
      <div className="detail-info">{film.director && <div><span>Directed by</span><strong>{film.director}</strong></div>}{film.language && <div><span>Language</span><strong>{film.language}</strong></div>}{film.cast && <div className="cast-row"><span>Featuring</span><strong>{film.cast}</strong></div>}{film.creatorName && <div><span>Presented by</span><strong>{film.creatorName}</strong></div>}</div>
      {film.tags?.length > 0 && <div className="film-tags">{film.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      <div className="reviews-section"><SectionHeading eyebrow="FROM THE AUDIENCE" title="Reviews" action={<button className="text-button" onClick={() => user ? setReviewOpen((open) => !open) : navigate("/account")}><MessageCircle size={15} />{user ? "Write a review" : "Sign in to review"}</button>} />
        {reviewOpen && <form className="review-form" onSubmit={submitReview}><label>Your rating <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5,4,3,2,1].map((value) => <option value={value} key={value}>{value} stars</option>)}</select></label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What stayed with you?" rows={3} /><button className="button button-gold" disabled={busy}><Send size={15} />Submit review</button></form>}
        {reviewsState.error && <Notice message={reviewsState.error} onRetry={reviewsState.reload} />}
        {reviewsState.loading ? <Loading label="Loading reviews…" /> : reviewsState.data?.length ? <div className="review-list">{reviewsState.data.map((review) => <article className="review-card" key={review.id}><div className="review-heading"><div className="avatar">{review.userName?.[0] || "F"}</div><div><strong>{review.userName || "Film lover"}</strong><small>{new Date(review.createdAt).toLocaleDateString()}</small></div><span className="review-rating"><Star size={13} fill="currentColor" />{review.rating}.0</span></div>{review.comment && <p>{review.comment}</p>}</article>)}</div> : <p className="muted review-empty">Be the first to share what you thought of this film.</p>}
      </div>
    </div><aside className="detail-aside"><div className="membership-card"><CrownIcon /><p className="eyebrow">THE PREMIERE COLLECTION</p><h3>More cinema.<br />Fewer interruptions.</h3><p>Support filmmakers and unlock the complete collection with a membership.</p><Link href="/plans" className="button button-gold button-block">Explore membership<ArrowRight size={15} /></Link></div></aside></div>
      {related.error && <Notice message={related.error} onRetry={related.reload} />}<FilmRail eyebrow="KEEP EXPLORING" title="More like this" films={related.data || []} />
    </PageFrame>
    {resumePromptOpen && <div className="modal-backdrop resume-backdrop" role="presentation"><section className="resume-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-title" tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "Escape") setResumePromptOpen(false);
    }}>
      <span className="player-brand-mark"><FilmIcon size={20} /></span><p className="eyebrow">YOUR PLACE IS SAVED</p><h2 id="resume-title">Pick up where you left off?</h2>
      <p className="muted">You watched {formatDuration(film.watchProgress)} of {formatDuration(film.duration)}.</p>
      <div className="resume-actions"><button className="button button-gold" onClick={() => void selectPlaybackPosition(true)} disabled={busy}><Play size={15} fill="currentColor" />Resume</button><button className="button button-glass" onClick={() => void selectPlaybackPosition(false)} disabled={busy}>Start over</button><button className="text-button" onClick={() => setResumePromptOpen(false)} disabled={busy}>Cancel</button></div>
    </section></div>}
    {videoOpen && <VideoPlayer film={film} initialPosition={initialPosition} onClose={() => { setVideoOpen(false); filmState.reload(); }} onSaveError={setMutationError} />}
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
  const plans = plansState.data || [];
  const [message, setMessage] = useState("");
  return <PageFrame><section className="page-hero compact centered"><p className="eyebrow">A LITTLE MORE CINEMA</p><h1>Choose your<br /><em>premiere.</em></h1><p>Discover more of the stories you love, while giving creators more room to tell them.</p></section>
    {plansState.error && <Notice message={plansState.error} onRetry={plansState.reload} />}
    {plansState.loading ? <Loading label="Loading available plans…" /> : plans.length ? <div className="plan-grid">{plans.map((plan, index) => <article className={`plan-card ${index === 1 ? "featured-plan" : ""}`} key={plan.id}>{index === 1 && <span className="plan-ribbon">MOST LOVED</span>}<span className="plan-icon">{index === 1 ? <Award size={22} /> : <FilmIcon size={22} />}</span><h2>{plan.name}</h2><p className="plan-price"><small>KES</small> {plan.priceMonthly.toLocaleString()}<span>/ month</span></p><ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul><button className={`button ${index === 1 ? "button-gold" : "button-glass"} button-block`} onClick={() => setMessage("Membership checkout is not connected. You have not been charged.")}>Choose {plan.name}<ArrowRight size={15} /></button></article>)}</div> : <EmptyState title="No membership plans yet" message="There are no plans available right now." />}
    <p className="fine-print">Plans are shown for preview. Payments and subscription management are not connected yet.</p>
    {message && <div className="toast-message" role="status">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
  </PageFrame>;
}

function AccountPage() {
  const { user, loading, refresh, signOut } = useContext(AuthContext);
  const { navigate } = useRouter();
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const subscription = useLoad<Record<string, unknown>>(user ? "account/subscription" : null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || ""),
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      role: String(form.get("role") || "audience"),
    };
    try {
      await api(registering ? "auth/register" : "auth/login", {
        method: "POST",
        body: JSON.stringify(registering ? payload : { email: payload.email, password: payload.password }),
      });
      await refresh();
      navigate("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to access your account.");
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <PageFrame><Loading label="Checking your account…" /></PageFrame>;
  if (user) return <PageFrame><PageTitle eyebrow="YOUR ACCOUNT" title={`Welcome, ${user.name.split(" ")[0]}.`} description={user.email} />
    <div className="account-card panel"><p className="eyebrow">ACCOUNT TYPE</p><h2>{user.role === "audience" ? "Audience member" : user.role === "creator" ? "Creator account" : "Administrator"}</h2><p>{user.isDemo ? "Demo account — activity is excluded from real platform analytics." : "Your account is active."}</p>
      {user.role === "creator" && <Link className="button button-outline" href="/creator">Open Creator Studio<ArrowRight size={15} /></Link>}
      {user.role === "admin" && <Link className="button button-outline" href="/admin">Open admin dashboard<ArrowRight size={15} /></Link>}
      {user.role === "audience" && <section className="account-subscription"><p className="eyebrow">SUBSCRIPTION</p>{subscription.loading ? <Loading label="Checking subscription…" /> : subscription.error ? <Notice message={subscription.error} onRetry={subscription.reload} /> : subscription.data ? <p>{String(subscription.data.planName)} · {String(subscription.data.status)}</p> : <p className="muted">No active subscription. Payments are not connected yet.</p>}</section>}
      <button className="button button-glass" onClick={() => void signOut().then(() => navigate("/")).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to sign out."))}><LogOut size={15} />Sign out</button>
      {error && <Notice message={error} />}
    </div>
  </PageFrame>;
  return <PageFrame className="account-access-page"><div className={`account-access-content ${registering ? "registering" : ""}`}>
    <section className="page-hero compact centered"><p className="eyebrow">FILAMUREEL ACCOUNT</p><h1>Your stories. <em>Your place.</em></h1><p>Sign in or create an account to continue.</p></section>
    <form className="account-form panel" onSubmit={(event) => void submit(event)}>
      <div className="account-form-tabs" role="group" aria-label="Account access options">
        <button type="button" aria-pressed={!registering} className={!registering ? "selected" : ""} onClick={() => { setRegistering(false); setError(""); }}>Sign in</button>
        <button type="button" aria-pressed={registering} className={registering ? "selected" : ""} onClick={() => { setRegistering(true); setError(""); }}>Create account</button>
      </div>
      {registering && <label className="form-field"><span>Name</span><input name="name" autoComplete="name" required maxLength={100} /></label>}
      <label className="form-field"><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="form-field"><span>Password (at least 12 characters)</span><input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} maxLength={128} required /></label>
      {registering && <label className="form-field"><span>Account type</span><select name="role"><option value="audience">Audience</option><option value="creator">Creator</option></select></label>}
      {error && <Notice message={error} />}
      <button className="button button-gold button-block" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}<ArrowRight size={15} /></button>
      {registering && <p className="account-hint">Creator accounts can publish films. Uploads and publishing are subject to platform review.</p>}
    </form>
  </div></PageFrame>;
}

type AdminSection = "overview" | "users" | "films" | "reel" | "reviews" | "subscriptions" | "transactions" | "plans" | "audit";
function AdminDashboard() {
  const { user, loading: authLoading } = useContext(AuthContext);
  const [section, setSection] = useState<AdminSection>("overview");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = new URLSearchParams({ search }).toString();
  const endpoint = section === "overview" ? "admin/overview"
    : section === "users" ? `admin/users?${searchQuery}`
      : section === "films" ? "admin/films"
      : section === "reel" ? "admin/reel-items"
      : section === "reviews" ? "admin/reviews"
        : section === "subscriptions" ? "admin/subscriptions"
          : section === "transactions" ? "admin/transactions"
            : section === "plans" ? "admin/plans" : "admin/audit";
  const state = useLoad<unknown>(user?.role === "admin" ? endpoint : null);
  const overview = state.data && section === "overview" ? state.data as Record<string, unknown> : {};
  const mutate = async (path: string, method: string, body?: unknown) => {
    setError("");
    setMessage("");
    try {
      await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setMessage("Saved.");
      state.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The change could not be saved.");
    }
  };
  if (authLoading) return <PageFrame><Loading label="Checking administrator access…" /></PageFrame>;
  if (user?.role !== "admin") return <PageFrame><EmptyState title="Administrator access required" message="Sign in with an administrator account to view platform management." href="/account" action="Sign in" /></PageFrame>;
  const sections: { id: AdminSection; label: string; icon: typeof Activity }[] = [
    { id: "overview", label: "Overview", icon: Activity }, { id: "users", label: "Accounts", icon: Users },
    { id: "films", label: "Films", icon: FilmIcon }, { id: "reel", label: "The Reel", icon: Play },
    { id: "reviews", label: "Reviews", icon: MessageCircle }, { id: "subscriptions", label: "Subscriptions", icon: CreditCard },
    { id: "transactions", label: "Transactions", icon: CircleDollarSign }, { id: "plans", label: "Plans", icon: Ticket },
    { id: "audit", label: "Admin log", icon: ClipboardList }
  ];
  return <PageFrame wide><div className="admin-shell"><aside className="admin-sidebar"><p className="eyebrow">PLATFORM ADMIN</p><nav>{sections.map(({ id, label, icon: Icon }) => <button className={section === id ? "selected" : ""} key={id} onClick={() => { setSection(id); setError(""); setMessage(""); }}><Icon size={16} />{label}</button>)}</nav></aside>
    <section className="admin-main">
      <PageTitle eyebrow="PLATFORM OPERATIONS" title={sections.find((item) => item.id === section)?.label || "Overview"} description="Monitor verified platform activity and manage accounts and content." />
      {error && <Notice message={error} />}{message && <div className="notice success" role="status">{message}</div>}{state.error && <Notice message={state.error} onRetry={state.reload} />}
      {state.loading ? <Loading label="Loading platform data…" /> : section === "overview" ? <AdminOverview data={overview} setSection={setSection} mutate={mutate} />
        : section === "users" ? <AdminUsers data={state.data as { users: AdminUser[]; total: number } | null} search={search} setSearch={setSearch} mutate={mutate} />
          : section === "films" ? <AdminFilms data={state.data as Film[] | null} mutate={mutate} />
            : section === "reel" ? <AdminReel data={state.data as AdminReelItem[] | null} mutate={mutate} />
          : section === "reviews" ? <AdminReviews data={state.data as AdminReview[] | null} mutate={mutate} />
            : section === "subscriptions" ? <AdminSubscriptions data={state.data as AdminSubscription[] | null} mutate={mutate} />
              : section === "transactions" ? <AdminTransactions data={state.data as AdminTransaction[] | null} />
                : section === "plans" ? <AdminPlans data={state.data as AdminPlan[] | null} mutate={mutate} />
                  : <AdminAudit data={state.data as AdminAuditEntry[] | null} />}
    </section>
  </div></PageFrame>;
}

type AdminUser = { id: number; name: string; email: string; role: string; status: string; activeSubscriptions: number; createdAt: string };
type AdminReview = { id: number; rating: number; comment: string | null; status: string; filmTitle: string; userName: string; createdAt: string };
type AdminSubscription = { id: number; userId: number; userName: string; email: string; planId: number; planName: string; status: string; provider: string; startsAt: string; endsAt: string | null };
type AdminTransaction = { id: number; userName: string | null; provider: string; providerReference: string; type: string; amount: number; currency: string; status: string; verifiedAt: string | null; createdAt: string };
type AdminPlan = { id: number; name: string; priceMonthly: number; priceAnnual: number; features: string[]; isPopular: boolean };
type AdminAuditEntry = { id: number; action: string; entityType: string; entityId: number | null; adminName: string; createdAt: string };
type AdminReelItem = ReelItem & { status: "pending" | "published" | "hidden" | "rejected"; createdAt: string };

function AdminOverview({ data, setSection, mutate }: { data: Record<string, unknown>; setSection: (section: AdminSection) => void; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const reviews = Array.isArray(data.recentReviews) ? data.recentReviews as (AdminReview & { id: number })[] : [];
  const revenue = Array.isArray(data.revenue) ? data.revenue as { currency: string; netAmount: number; verifiedTransactions: number }[] : [];
  const days = Array.isArray(data.playsByDay) ? data.playsByDay as { date: string; plays: number }[] : [];
  const maxPlays = Math.max(1, ...days.map((day) => day.plays));
  const stats: [string, string, string, LucideIcon][] = [
    ["Accounts", Number(data.users || 0).toLocaleString(), `${Number(data.newUsers30d || 0)} new in 30 days`, Users],
    ["Creators", Number(data.creatorAccounts || 0).toLocaleString(), `${Number(data.audienceAccounts || 0)} audience accounts`, Clapperboard],
    ["Published films", Number(data.publishedFilms || 0).toLocaleString(), `${Number(data.pendingFilms || 0)} awaiting review`, FilmIcon],
    ["Film plays", Number(data.filmPlays || 0).toLocaleString(), `${Number(data.uniqueViewers || 0)} real accounts`, Play],
    ["Watch time", formatDuration(Number(data.watchTimeSeconds || 0)), "From recorded playback checkpoints", Clock3],
    ["Reviews", Number(data.reviews || 0).toLocaleString(), `${Number(data.hiddenReviews || 0)} hidden`, MessageCircle],
    ["Active subscriptions", Number(data.activeSubscriptions || 0).toLocaleString(), `${Number(data.activeSessions || 0)} active sessions`, CreditCard],
    ["Verified revenue", (data.revenueAvailable ? revenue.map((item) => `${item.currency} ${item.netAmount.toLocaleString()}`).join(" · ") : "Unavailable"), data.paymentIntegrationAvailable ? "Verified transactions only" : "Payment provider not connected", CircleDollarSign]
  ];
  return <>
    <div className="admin-stat-grid">{stats.map(([label, value, detail, Icon]) => <article className="admin-stat-card" key={label}><span><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{detail}</em></article>)}</div>
    {!data.paymentIntegrationAvailable && <div className="notice">Revenue reporting will show verified transactions when a payment provider is connected. No revenue is estimated or invented.</div>}
    <section className="panel admin-chart"><div className="panel-heading"><div><p className="eyebrow">LAST 30 DAYS</p><h2>Film plays by day</h2></div></div>{days.some((item) => item.plays > 0) ? <div className="bar-chart large">{days.map((day) => <div className="bar-column" key={day.date} title={`${day.date}: ${day.plays} plays`}><i style={{ height: `${Math.max(4, day.plays / maxPlays * 100)}%` }} /><small>{new Date(`${day.date}T00:00:00`).getDate()}</small></div>)}</div> : <div className="chart-placeholder">No viewer playback has been recorded yet.</div>}</section>
    <section className="panel admin-review-panel"><div className="panel-heading"><div><p className="eyebrow">RECENT MODERATION</p><h2>Latest reviews</h2></div><button className="text-button" onClick={() => setSection("reviews")}>All reviews<ArrowRight size={14} /></button></div>
      {reviews.length ? <div className="admin-review-list">{reviews.map((review) => <article key={review.id}><div><strong>{review.filmTitle}</strong><small>{review.userName} · {review.rating}/5 · {review.status}</small><p>{review.comment || "No written comment."}</p></div><button className="text-button" onClick={() => void mutate(`admin/reviews/${review.id}`, "PATCH", { status: review.status === "hidden" ? "published" : "hidden" })}>{review.status === "hidden" ? "Restore" : "Hide"}</button></article>)}</div> : <p className="muted panel-empty">No audience reviews recorded.</p>}
    </section>
  </>;
}

function AdminUsers({ data, search, setSearch, mutate }: { data: { users: AdminUser[]; total: number } | null; search: string; setSearch: (value: string) => void; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const accounts = Array.isArray(data?.users) ? data.users : [];
  return <section className="panel"><div className="admin-toolbar"><label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" /></label><span>{data?.total || 0} accounts</span></div>
    {accounts.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Account</th><th>Role</th><th>Subscriptions</th><th>Created</th><th>Status</th><th /></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><small className="admin-subline">{account.email}</small></td><td>{account.role === "admin" ? "Admin" : <select aria-label={`Role for ${account.name}`} value={account.role} onChange={(event) => void mutate("admin/users", "PATCH", { userId: account.id, role: event.target.value })}><option value="audience">Audience</option><option value="creator">Creator</option></select>}</td><td>{account.activeSubscriptions}</td><td>{new Date(account.createdAt).toLocaleDateString()}</td><td><span className={`status-pill ${account.status === "active" ? "status-active" : "status-inactive"}`}>{account.status}</span></td><td>{account.role !== "admin" && <button className="text-button danger" onClick={() => void mutate("admin/users", "PATCH", { userId: account.id, status: account.status === "active" ? "suspended" : "active" })}>{account.status === "active" ? "Suspend" : "Reactivate"}</button>}</td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No registered accounts match this search.</p>}
  </section>;
}

function AdminFilms({ data, mutate }: { data: Film[] | null; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">CATALOG CONTROL</p><h2>Film review and publishing</h2></div></div>
    {data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Film</th><th>Creator</th><th>Status</th><th>Featured</th><th>Festival winner</th></tr></thead><tbody>{data.map((film) => <tr key={film.id}>
      <td><Link href={`/film/${film.id}`} className="table-film"><Poster film={film} /><span><strong>{film.title}</strong><small>{film.category || film.genre || "Film"}</small></span></Link></td>
      <td>{film.creatorName}</td>
      <td><select aria-label={`Status for ${film.title}`} value={film.status || "published"} onChange={(event) => void mutate(`admin/films/${film.id}`, "PATCH", { status: event.target.value })}><option value="draft">Draft</option><option value="pending">Pending</option><option value="published">Published</option><option value="rejected">Rejected</option></select></td>
      <td><input type="checkbox" aria-label={`Feature ${film.title}`} checked={film.isFeatured} onChange={(event) => void mutate(`admin/films/${film.id}`, "PATCH", { isFeatured: event.target.checked })} /></td>
      <td><input type="checkbox" aria-label={`Mark ${film.title} festival winner`} checked={film.isFestivalWinner} onChange={(event) => void mutate(`admin/films/${film.id}`, "PATCH", { isFestivalWinner: event.target.checked })} /></td>
    </tr>)}</tbody></table></div> : <p className="muted panel-empty">No films from registered creator accounts yet.</p>}
  </section>;
}

function AdminReviews({ data, mutate }: { data: AdminReview[] | null; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">AUDIENCE CONTENT</p><h2>Review moderation</h2></div></div>
    {data?.length ? <div className="admin-review-list">{data.map((review) => <article key={review.id}><div><strong>{review.filmTitle} · {review.rating}/5</strong><small>{review.userName} · {new Date(review.createdAt).toLocaleDateString()} · {review.status}</small><p>{review.comment || "No written comment."}</p></div><button className="text-button" onClick={() => void mutate(`admin/reviews/${review.id}`, "PATCH", { status: review.status === "hidden" ? "published" : "hidden" })}>{review.status === "hidden" ? "Restore" : "Hide"}</button></article>)}</div> : <p className="muted panel-empty">No audience reviews to moderate.</p>}
  </section>;
}

function AdminSubscriptions({ data, mutate }: { data: AdminSubscription[] | null; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const users = useLoad<{ users: AdminUser[] }>("admin/users?limit=100");
  const plans = useLoad<AdminPlan[]>("admin/plans");
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState("");
  return <div className="admin-stack"><form className="panel admin-inline-form" onSubmit={(event) => {
    event.preventDefault();
    void mutate("admin/subscriptions", "POST", { userId: Number(userId), planId: Number(planId), status: "active" });
  }}><div><p className="eyebrow">MANUAL ENTITLEMENT</p><h2>Grant a subscription</h2><p className="muted">Manual grants do not represent a payment or add revenue.</p></div>
    <label className="form-field"><span>Account</span><select required value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Select account</option>{(users.data?.users || []).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
    <label className="form-field"><span>Plan</span><select required value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">Select plan</option>{(plans.data || []).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label><button className="button button-gold">Grant access</button>
  </form><section className="panel"><div className="panel-heading"><div><p className="eyebrow">ENTITLEMENTS</p><h2>Subscriptions</h2></div></div>
    {data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Account</th><th>Plan</th><th>Source</th><th>Started</th><th>Status</th><th /></tr></thead><tbody>{data.map((subscription) => <tr key={subscription.id}><td><strong>{subscription.userName}</strong><small className="admin-subline">{subscription.email}</small></td><td>{subscription.planName}</td><td>{subscription.provider}</td><td>{new Date(subscription.startsAt).toLocaleDateString()}</td><td><span className="status-pill">{subscription.status}</span></td><td><button className="text-button" onClick={() => void mutate(`admin/subscriptions/${subscription.id}`, "PATCH", { status: subscription.status === "active" ? "canceled" : "active" })}>{subscription.status === "active" ? "Cancel" : "Activate"}</button></td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No subscriptions on real accounts yet.</p>}
  </section></div>;
}

function AdminTransactions({ data }: { data: AdminTransaction[] | null }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">VERIFIED PAYMENT RECORDS</p><h2>Transactions</h2></div></div>
    {data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Account</th><th>Type</th><th>Amount</th><th>Provider / reference</th><th>Status</th><th>Verified</th></tr></thead><tbody>{data.map((transaction) => <tr key={transaction.id}><td>{transaction.userName || "Account removed"}</td><td className="capitalize">{transaction.type.replaceAll("_", " ")}</td><td>{transaction.currency} {transaction.amount.toLocaleString()}</td><td>{transaction.provider}<small className="admin-subline">{transaction.providerReference}</small></td><td>{transaction.status}</td><td>{transaction.verifiedAt ? new Date(transaction.verifiedAt).toLocaleDateString() : "Not verified"}</td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No verified payment transactions are recorded. Connect a payment provider before reporting revenue.</p>}
  </section>;
}

function AdminPlans({ data, mutate }: { data: AdminPlan[] | null; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || ""),
      priceMonthly: Number(form.get("priceMonthly")),
      priceAnnual: Number(form.get("priceAnnual")),
      features: String(form.get("features") || "").split("\n").map((feature) => feature.trim()).filter(Boolean),
    };
    await mutate("admin/plans", "POST", payload);
    setBusy(false);
  };
  const savePlan = async (event: FormEvent<HTMLFormElement>, plan: AdminPlan) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(`admin/plans/${plan.id}`, "PATCH", {
      name: String(form.get("name") || ""),
      priceMonthly: Number(form.get("priceMonthly")),
      priceAnnual: Number(form.get("priceAnnual")),
      features: String(form.get("features") || "").split("\n").map((feature) => feature.trim()).filter(Boolean),
      isPopular: form.get("isPopular") === "on",
    });
  };
  return <div className="admin-stack"><form className="panel admin-plan-form" onSubmit={(event) => void submit(event)}><p className="eyebrow">PLAN MANAGEMENT</p><h2>Add a plan</h2>
    <div className="form-grid"><label className="form-field"><span>Name</span><input name="name" required maxLength={100} /></label><label className="form-field"><span>Monthly price (KES)</span><input name="priceMonthly" type="number" min="0" step=".01" required /></label><label className="form-field"><span>Annual price (KES)</span><input name="priceAnnual" type="number" min="0" step=".01" required /></label><label className="form-field"><span>Features (one per line)</span><textarea name="features" rows={3} /></label></div>
    <button className="button button-gold" disabled={busy}>{busy ? "Saving…" : "Add plan"}</button></form>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">AVAILABLE PLANS</p><h2>Subscription plans</h2></div></div>
      {Array.isArray(data) && data.map((plan) => <form className="admin-plan-edit" key={plan.id} onSubmit={(event) => void savePlan(event, plan)}>
        <div className="admin-plan-fields"><label className="form-field"><span>Plan name</span><input name="name" defaultValue={plan.name} required maxLength={100} /></label>
          <label className="form-field"><span>Monthly (KES)</span><input name="priceMonthly" type="number" min="0" step=".01" defaultValue={plan.priceMonthly} required /></label>
          <label className="form-field"><span>Annual (KES)</span><input name="priceAnnual" type="number" min="0" step=".01" defaultValue={plan.priceAnnual} required /></label>
          <label className="form-field"><span>Features (one per line)</span><textarea name="features" rows={3} defaultValue={plan.features.join("\n")} /></label>
          <label className="form-check"><input name="isPopular" type="checkbox" defaultChecked={plan.isPopular} />Popular plan</label>
        </div><div className="admin-plan-actions"><button className="button button-outline button-small">Save changes</button><button type="button" className="text-button danger" onClick={() => void mutate(`admin/plans/${plan.id}`, "DELETE")}>Delete</button></div>
      </form>)}
    </section></div>;
}

function AdminAudit({ data }: { data: AdminAuditEntry[] | null }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ADMINISTRATIVE CHANGES</p><h2>Audit log</h2></div></div>
    {data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>When</th><th>Administrator</th><th>Action</th><th>Record</th></tr></thead><tbody>{data.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.adminName}</td><td>{entry.action}</td><td>{entry.entityType} {entry.entityId ?? ""}</td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No administrative changes recorded.</p>}
  </section>;
}

function AdminReel({ data, mutate }: { data: AdminReelItem[] | null; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">CREATOR SUBMISSIONS</p><h2>Review The Reel</h2></div></div>
    {data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Content</th><th>Section</th><th>Creator</th><th>Related film</th><th>Status</th><th>Featured</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{data.map((item) => <tr key={item.id}><td><strong>{item.title}</strong>{item.mediaType === "audio" ? <audio className="reel-admin-preview" src={item.videoUrl} controls preload="metadata" /> : <video className="reel-admin-preview" src={item.videoUrl} poster={item.posterUrl || undefined} controls preload="metadata" />}</td><td>{reelCategories.find((category) => category.id === item.category)?.label || item.category}</td><td>{item.creatorName}</td><td>{item.filmTitle || "Standalone"}</td><td><span className="status-pill">{item.status}</span></td><td>{item.isFeatured ? "Yes" : "No"}</td>
        <td className="reel-admin-actions">{item.status !== "published" && <button className="text-button" onClick={() => void mutate(`admin/reel-items/${item.id}`, "PATCH", { status: "published" })}>Publish</button>}
          {item.status !== "rejected" && <button className="text-button danger" onClick={() => void mutate(`admin/reel-items/${item.id}`, "PATCH", { status: "rejected" })}>Reject</button>}
          {item.status === "published" && <button className="text-button" onClick={() => void mutate(`admin/reel-items/${item.id}`, "PATCH", { status: "hidden" })}>Hide</button>}
          {item.status === "published" && <button className="text-button" onClick={() => void mutate(`admin/reel-items/${item.id}`, "PATCH", { isFeatured: !item.isFeatured })}>{item.isFeatured ? "Unfeature" : "Feature"}</button>}
        </td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No Reel content has been submitted for review.</p>}
  </section>;
}

function LegacyReelPage() {
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

type ReelCategory = "clips" | "interviews" | "podcasts" | "marketing";
type ReelItem = {
  id: number; filmId: number | null; category: ReelCategory; title: string; description: string | null;
  videoUrl: string; mediaType: "video" | "audio"; posterUrl: string | null; filmTitle: string | null; creatorName: string;
  isFeatured: boolean; reactionCount: number; ratingCount: number; averageRating: number | null;
  myReaction: string | null; myRating: number | null;
};
const reelCategories: { id: ReelCategory; label: string }[] = [
  { id: "clips", label: "Clips & trailers" }, { id: "interviews", label: "Interviews" },
  { id: "podcasts", label: "Podcasts" }, { id: "marketing", label: "Marketing" },
];
const reelReactions = [
  { id: "like", label: "Like", icon: ThumbsUp },
  { id: "love", label: "Love", icon: Heart },
  { id: "fire", label: "Fire", icon: Flame },
  { id: "wow", label: "Wow", icon: Star },
];

function ReelMedia({ item, vertical }: { item: ReelItem; vertical: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tracked = useRef(false);
  const [trackingError, setTrackingError] = useState("");
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !vertical || item.mediaType === "audio") return;
    video.muted = true;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting && entry.intersectionRatio >= .7) {
        void video.play().catch(() => setTrackingError("Tap play to watch this clip."));
      } else {
        video.pause();
      }
    }, { threshold: [.2, .7] });
    observer.observe(video);
    return () => { observer.disconnect(); video.pause(); };
  }, [item.mediaType, vertical]);
  const trackPlay = () => {
    if (!item.filmId) return;
    if (tracked.current) return;
    tracked.current = true;
    setTrackingError("");
    void api(`films/${item.filmId}/view`, {
      method: "POST", body: JSON.stringify({ mediaType: "trailer" }),
    }).catch((error: unknown) => {
      tracked.current = false;
      setTrackingError(error instanceof Error ? error.message : "Unable to record this play.");
    });
  };
  return <div className={`reel-media ${vertical ? "vertical" : ""} ${item.mediaType}`}>
    {item.mediaType === "audio"
      ? <audio src={item.videoUrl} controls preload="metadata" onPlay={trackPlay} aria-label={item.title} />
      : <video ref={videoRef} src={item.videoUrl} poster={item.posterUrl || undefined} controls playsInline preload="metadata" muted={vertical} onPlay={trackPlay} aria-label={item.title} />}
    {trackingError && <p className="reel-media-message" role="status">{trackingError}</p>}
  </div>;
}

function ReelPage() {
  const { user } = useContext(AuthContext);
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState<ReelCategory>("clips");
  const [viewMode, setViewMode] = useState<"grid" | "vertical">(() => window.matchMedia("(max-width: 760px)").matches ? "vertical" : "grid");
  const [actionError, setActionError] = useState("");
  const state = useLoad<ReelItem[]>(`reel-items?category=${activeTab}`);
  const activeCategory = reelCategories.find(({ id }) => id === activeTab)?.label ?? "Clips & trailers";
  const engage = async (item: ReelItem, kind: "reaction" | "rating", value: string | number | null) => {
    if (!user) { navigate("/account"); return; }
    if (user.role !== "audience" || user.isDemo) {
      setActionError("Sign in with a registered audience account to react or rate.");
      return;
    }
    setActionError("");
    try {
      if (kind === "reaction" && value === item.myReaction) {
        await api(`reel-items/${item.id}/reaction`, { method: "DELETE" });
      } else if (value === null) {
        await api(`reel-items/${item.id}/${kind}`, { method: "DELETE" });
      } else {
        await api(`reel-items/${item.id}/${kind}`, { method: "PUT", body: JSON.stringify({ [kind]: value }) });
      }
      state.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to save your response.");
    }
  };
  return <PageFrame wide><section className="page-hero compact"><p className="eyebrow">THE REEL · BEYOND THE SCREEN</p><h1>African cinema,<br /><em>in conversation.</em></h1><p>Explore clips and trailers, filmmaker interviews, podcasts, and marketing stories from creators across the continent.</p></section>
    <div className="reel-toolbar">
      <div className="editorial-tabs" role="tablist" aria-label="Editorial categories">{reelCategories.map(({ id, label }) => <button role="tab" aria-selected={activeTab === id} className={activeTab === id ? "selected" : ""} key={id} onClick={() => setActiveTab(id)}>{label}</button>)}</div>
      <div className="reel-view-toggle" role="group" aria-label="Reel layout">
        <button className={viewMode === "grid" ? "selected" : ""} aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}><Grid2X2 size={15} />Grid</button>
        <button className={viewMode === "vertical" ? "selected" : ""} aria-pressed={viewMode === "vertical"} onClick={() => setViewMode("vertical")}><Smartphone size={15} />Vertical</button>
      </div>
    </div>
    <SectionHeading eyebrow="THE REEL" title={activeCategory} description={activeTab === "clips" ? "Creator-submitted film trailers, reviewed by the FilamuReel team." : "This section is ready for curated content. Published items will appear here."} />
    {actionError && <Notice message={actionError} />}
    {state.error && <Notice message={state.error} onRetry={state.reload} />}
    {state.loading ? <Loading label="Loading Reel videos…" /> : state.data?.length ? <div className={`reel-feed ${viewMode}`}>
      {state.data.map((item) => <article className="reel-card" key={item.id}>
        <ReelMedia item={item} vertical={viewMode === "vertical"} />
        <div className="reel-card-copy"><p className="eyebrow">{item.isFeatured ? "FEATURED · " : ""}{activeCategory.toUpperCase()}</p>
          <h2>{item.title}</h2><p>{item.description || (item.filmTitle ? `A trailer for ${item.filmTitle}.` : `Shared by ${item.creatorName}.`)}</p>
          {item.filmId && item.filmTitle && <Link href={`/film/${item.filmId}`} className="reel-film-link">Discover {item.filmTitle}<ArrowRight size={14} /></Link>}
          <div className="reel-engagement"><div className="reel-reactions" aria-label="React to this video">{reelReactions.map(({ id, label, icon: Icon }) => <button key={id} className={item.myReaction === id ? "selected" : ""} aria-pressed={item.myReaction === id} aria-label={`${label} this video`} onClick={() => void engage(item, "reaction", id)}><Icon size={16} /></button>)}<span className="reel-reaction-count">{item.reactionCount} reactions</span></div>
            <div className="reel-rating"><span>{item.averageRating === null ? "Rate this clip" : `${item.averageRating.toFixed(1)} · ${item.ratingCount} ratings`}</span>
              <div>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} className={(item.myRating || 0) >= rating ? "selected" : ""} aria-label={`Rate ${rating} out of 5`} aria-pressed={item.myRating === rating} onClick={() => void engage(item, "rating", item.myRating === rating ? null : rating)}><Star size={15} fill={(item.myRating || 0) >= rating ? "currentColor" : "none"} /></button>)}</div>
            </div>
          </div>
        </div>
      </article>)}
    </div> : <div className="reel-empty panel"><span className="player-brand-mark"><FilmIcon size={19} /></span><h2>No published content here yet</h2><p>{activeTab === "clips" ? "Creators can submit a trailer from My Films or upload a standalone clip from Creator Studio. Approved videos appear here for audiences to watch, react to, and rate." : "Approved submissions in this section will appear here."}</p>{user?.role === "creator" && <Link href="/creator/reel" className="button button-outline">Upload to The Reel<ArrowRight size={15} /></Link>}</div>}
  </PageFrame>;
}

function CreatorLayout({ children }: { children: ReactNode }) {
  return <PageFrame wide><div className="creator-shell"><aside className="creator-sidebar"><p className="eyebrow">CREATOR STUDIO</p><nav><Link href="/creator"><LayoutDashboard size={16} />Overview</Link><Link href="/creator/films"><Clapperboard size={16} />My films</Link><Link href="/creator/reel"><Play size={16} />Reel uploads</Link><Link href="/creator/upload"><Upload size={16} />New release</Link><Link href="/creator/analytics"><BarChart3 size={16} />Analytics</Link><Link href="/creator/earnings"><Wallet size={16} />Earnings</Link></nav><div className="creator-note"><FilmIcon size={17} /><span>Your stories.<br />Your audience.</span></div></aside><section className="creator-main">{children}</section></div></PageFrame>;
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

function CreatorReel() {
    const films = useLoad<Film[]>("creator/films");
    const submissions = useLoad<{ id: number; filmId: number | null; category: ReelCategory; mediaType: "video" | "audio"; title: string; status: string; filmTitle: string | null; createdAt: string }[]>("creator/reel-submissions");
    const [category, setCategory] = useState<ReelCategory>("clips");
    const [mediaType, setMediaType] = useState<"video" | "audio">("video");
    const [form, setForm] = useState({ title: "", description: "", videoUrl: "", posterUrl: "", filmId: "" });
    const [uploading, setUploading] = useState<"videoUrl" | "posterUrl" | null>(null);
    const [uploads, setUploads] = useState<Partial<Record<"videoUrl" | "posterUrl", UploadStatus>>>({});
    const [step, setStep] = useState(0);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const categoryDescriptions: Record<ReelCategory, string> = {
      clips: "Film clips, teasers, and trailers. You can link a published film or submit a standalone clip.",
      interviews: "Filmmaker, cast, crew, or industry interviews.",
      podcasts: "Upload a podcast as audio or video. Audio files are playable directly in The Reel.",
      marketing: "Promotional films, campaign videos, and press content.",
    };
    const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
    const uploadMedia = async (key: "videoUrl" | "posterUrl", file?: File) => {
      if (!file) return;
      const isPoster = key === "posterUrl";
      const limit = (isPoster ? 10 : mediaType === "audio" ? 100 : 500) * 1024 * 1024;
      if (file.size > limit) {
        setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 0, status: "failed" } }));
        setError(`${isPoster ? "Poster images" : mediaType === "audio" ? "Audio files" : "Videos"} must be ${isPoster ? "10 MB" : mediaType === "audio" ? "100 MB" : "500 MB"} or smaller.`);
        return;
      }
      setError("");
      setUploading(key);
      setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 0, status: "uploading" } }));
      try {
        const result = await uploadFile(file, (progress) => setUploads((current) => ({
          ...current, [key]: { name: file.name, size: file.size, progress, status: "uploading" },
        })));
        update(key, result.url);
        setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 100, status: "complete" } }));
      } catch (reason) {
        setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 0, status: "failed" } }));
        setError(reason instanceof Error ? reason.message : "Unable to upload this media file.");
      } finally {
        setUploading(null);
      }
    };
    const submit = async (event: FormEvent) => {
      event.preventDefault();
      if (step < 2) {
        setError("");
        setStep((current) => current + 1);
        return;
      }
      setError("");
      setNotice("");
      setBusy(true);
      try {
        const payload = {
          category, title: form.title, description: form.description,
          videoUrl: form.videoUrl, mediaType, posterUrl: form.posterUrl,
          ...(form.filmId ? { filmId: Number(form.filmId) } : {}),
        };
        await api("creator/reel-submissions", { method: "POST", body: JSON.stringify(payload) });
        setNotice("Your Reel upload has been submitted for moderation.");
        setForm({ title: "", description: "", videoUrl: "", posterUrl: "", filmId: "" });
        setUploads({});
        setStep(0);
        submissions.reload();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to submit this Reel upload.");
      } finally {
        setBusy(false);
      }
    };
    const categoryLabel = (id: ReelCategory) => reelCategories.find((item) => item.id === id)?.label || id;
    return <CreatorLayout>
      <PageTitle eyebrow="CREATOR STUDIO · THE REEL" title="Upload to The Reel." description="Choose the section your content belongs in. Every submission is reviewed before it appears publicly." />
      {notice && <div className="notice success" role="status">{notice}</div>}
      {error && <Notice message={error} />}
      {films.error && <Notice message={films.error} onRetry={films.reload} />}
      <form className="panel reel-upload-form creator-upload-wizard" onSubmit={(event) => void submit(event)}>
        <CreatorWizardSteps steps={["Choose section", "Add your media", "Review & submit"]} current={step} />
        {step === 0 && <>
          <div className="form-grid">
            <label className="form-field"><span>Where should this appear?</span><select value={category} onChange={(event) => { const next = event.target.value as ReelCategory; setCategory(next); setMediaType(next === "podcasts" ? "audio" : "video"); }}>{reelCategories.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select></label>
            {category === "podcasts" && <label className="form-field"><span>Podcast format</span><select value={mediaType} onChange={(event) => setMediaType(event.target.value as "video" | "audio")}><option value="audio">Audio</option><option value="video">Video</option></select></label>}
            <label className="form-field full"><span>Give it a title</span><input value={form.title} onChange={(event) => update("title", event.target.value)} required maxLength={200} placeholder={category === "podcasts" ? "Episode title" : category === "interviews" ? "Who or what is this interview about?" : "Give your video a title"} /></label>
          </div>
          <p className="reel-category-help">{categoryDescriptions[category]} The selected section determines where your upload appears after approval.</p>
        </>}
        {step === 1 && <>
          <div className="form-grid">
            <label className="form-field full"><span>Description <i>(optional)</i></span><textarea value={form.description} onChange={(event) => update("description", event.target.value)} rows={3} maxLength={4000} placeholder="Add context for viewers." /></label>
            <label className="form-field full"><span>{mediaType === "audio" ? "Audio file or URL" : "Video file or URL"}</span><input value={form.videoUrl} onChange={(event) => { update("videoUrl", event.target.value); setUploads((current) => ({ ...current, videoUrl: undefined })); }} required maxLength={2048} placeholder={`Paste a link or upload a ${mediaType} file below`} /></label>
            <div className="reel-file-field"><label className="file-picker"><span><Upload size={14} />{uploading === "videoUrl" ? "Uploading…" : `Choose ${mediaType} file`}</span><input type="file" accept={mediaType === "audio" ? "audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac" : "video/mp4,video/webm,video/quicktime"} disabled={uploading !== null} onChange={(event) => { void uploadMedia("videoUrl", event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label><small>{mediaType === "audio" ? "MP3, M4A, WAV, OGG, AAC · max 100 MB" : "MP4, WebM, QuickTime · max 500 MB"}</small>{uploads.videoUrl && <UploadFileStatus upload={uploads.videoUrl} />}</div>
            <label className="form-field full"><span>Thumbnail link <i>(optional)</i></span><input value={form.posterUrl} onChange={(event) => { update("posterUrl", event.target.value); setUploads((current) => ({ ...current, posterUrl: undefined })); }} maxLength={2048} placeholder="Paste a link or upload an image" /></label>
            <div className="reel-file-field"><label className="file-picker"><span><Upload size={14} />{uploading === "posterUrl" ? "Uploading…" : "Choose thumbnail"}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null} onChange={(event) => { void uploadMedia("posterUrl", event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label><small>JPEG, PNG, WebP · max 10 MB</small>{uploads.posterUrl && <UploadFileStatus upload={uploads.posterUrl} />}</div>
            <label className="form-field full"><span>Connect to a film <i>(optional)</i></span><select value={form.filmId} onChange={(event) => update("filmId", event.target.value)}><option value="">Standalone Reel content</option>{films.data?.filter((film) => film.status === "published").map((film) => <option value={film.id} key={film.id}>{film.title}</option>)}</select></label>
          </div>
        </>}
        {step === 2 && <div className="upload-review">
          <p className="eyebrow">READY FOR REVIEW</p><h2>{form.title}</h2>
          <dl><div><dt>Section</dt><dd>{categoryLabel(category)}</dd></div><div><dt>Format</dt><dd>{mediaType === "audio" ? "Audio podcast" : "Video"}</dd></div><div><dt>Media</dt><dd>{form.videoUrl.startsWith("/uploads/") ? uploads.videoUrl?.name || "Uploaded to FilamuReel" : form.videoUrl}</dd></div><div><dt>Thumbnail</dt><dd>{form.posterUrl ? "Added" : "Not provided"}</dd></div><div><dt>Related film</dt><dd>{films.data?.find((film) => String(film.id) === form.filmId)?.title || "Standalone content"}</dd></div></dl>
          <p className="reel-category-help">Your upload stays private until reviewed. Once approved, it appears in {categoryLabel(category)} for audiences to discover.</p>
        </div>}
        <div className="form-actions wizard-actions">{step > 0 && <button type="button" className="button button-glass" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={15} />Back</button>}<button className="button button-gold" disabled={busy || uploading !== null}>{busy ? "Submitting…" : step === 2 ? "Submit for review" : "Continue"}{step === 2 ? <Upload size={15} /> : <ArrowRight size={15} />}</button></div>
      </form>
      <section className="panel reel-submission-list"><div className="panel-heading"><div><p className="eyebrow">YOUR UPLOADS</p><h2>Submission status</h2></div><button className="text-button" onClick={submissions.reload}>Refresh</button></div>
        {submissions.error && <Notice message={submissions.error} onRetry={submissions.reload} />}
        {submissions.loading ? <Loading label="Loading your submissions…" /> : submissions.data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Title</th><th>Section</th><th>Related film</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
          {submissions.data.map((item) => <tr key={item.id}><td>{item.title}</td><td>{categoryLabel(item.category)}</td><td>{item.filmTitle || "Standalone"}</td><td><span className={`status-pill reel-status-${item.status}`}>{item.status}</span></td><td>{new Date(item.createdAt).toLocaleDateString()}</td></tr>)}
        </tbody></table></div> : <p className="muted panel-empty">You have no Reel uploads yet.</p>}
      </section>
    </CreatorLayout>;
}

function CreatorFilms() {
  const state = useLoad<Film[]>("creator/films");
  const submissions = useLoad<{ id: number; filmId: number | null; category: ReelCategory; title: string; status: string; filmTitle: string | null }[]>("creator/reel-submissions");
  const [notice, setNotice] = useState("");
  const submitTrailer = async (film: Film) => {
    setNotice("");
    try {
      await api("creator/reel-submissions", { method: "POST", body: JSON.stringify({ filmId: film.id }) });
      setNotice(`“${film.title}” trailer submitted for review.`);
      submissions.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to submit this trailer.");
    }
  };
  const remove = async (film: Film) => {
    if (!window.confirm(`Delete “${film.title}”? This cannot be undone.`)) return;
    try { await api(`films/${film.id}`, { method: "DELETE" }); state.reload(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to delete film."); }
  };
  return <CreatorLayout><PageTitle eyebrow="YOUR PORTFOLIO" title="My films." description="Manage your releases and see how they are performing." action={<Link href="/creator/upload" className="button button-gold"><Plus size={16} />New release</Link>} />
    {notice && <Notice message={notice} />}{state.error && <Notice message={state.error} onRetry={state.reload} />}{submissions.error && <Notice message={submissions.error} onRetry={submissions.reload} />}
    {state.loading || submissions.loading ? <Loading /> : state.data?.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Film</th><th>Status</th><th>Access</th><th>Views</th><th>The Reel</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{state.data.map((film) => {
      const submission = submissions.data?.find((item) => item.filmId === film.id && item.category === "clips");
      return <tr key={film.id}><td><Link href={`/film/${film.id}`} className="table-film"><Poster film={film} /><span><strong>{film.title}</strong><small>{film.category || film.genre || "Film"}</small></span></Link></td><td><span className="status-pill">{film.status || "Published"}</span></td><td className="capitalize">{film.monetization.replaceAll("_", " ")}</td><td>{Number(film.viewCount || 0).toLocaleString()}</td>
        <td>{submission ? <>{submission.status === "rejected" && <button className="text-button" onClick={() => void submitTrailer(film)}>Resubmit</button>} <span className={`status-pill reel-status-${submission.status}`}>{submission.status}</span></> : film.trailerUrl ? <button className="text-button" disabled={film.status !== "published"} onClick={() => void submitTrailer(film)}>{film.status === "published" ? "Submit trailer" : "Publish first"}</button> : <span className="muted">Add a trailer first</span>}</td>
        <td><button className="text-button danger" onClick={() => void remove(film)}>Delete</button></td></tr>;
    })}</tbody></table></div> : <EmptyState title="Your portfolio is empty" message="Bring your first story to FilamuReel and meet the people ready to see it." href="/creator/upload" action="Publish your first film" />}</CreatorLayout>;
}

function UploadFilm() {
  const categories = useLoad<Category[]>("categories");
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Partial<Record<"posterUrl" | "trailerUrl" | "videoUrl", UploadStatus>>>({});
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ title: "", description: "", category: "", genre: "", region: "", language: "", director: "", cast: "", duration: "", posterUrl: "", trailerUrl: "", videoUrl: "", monetization: "subscription", price: "" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const upload = async (key: "posterUrl" | "trailerUrl" | "videoUrl", file?: File) => {
    if (!file) return;
    const isPoster = key === "posterUrl";
    const limit = (isPoster ? 10 : 500) * 1024 * 1024;
    if (file.size > limit) {
      setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 0, status: "failed" } }));
      setError(`${isPoster ? "Poster images" : "Videos"} must be ${isPoster ? "10 MB" : "500 MB"} or smaller.`);
      return;
    }
    setError("");
    setUploading(key);
    setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 0, status: "uploading" } }));
    try {
      const result = await uploadFile(file, (progress) => setUploads((current) => ({
        ...current, [key]: { name: file.name, size: file.size, progress, status: "uploading" },
      })));
      update(key, result.url);
      setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 100, status: "complete" } }));
    } catch (reason) {
      setUploads((current) => ({ ...current, [key]: { name: file.name, size: file.size, progress: 0, status: "failed" } }));
      setError(reason instanceof Error ? reason.message : "Unable to upload this media file.");
    } finally {
      setUploading(null);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step < 3) {
      setError("");
      setStep((current) => current + 1);
      return;
    }
    setBusy(true); setError("");
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
    <form className="upload-form creator-upload-wizard" onSubmit={submit}>
      <div className="panel form-panel wizard-panel"><CreatorWizardSteps steps={["Film details", "Add media", "Release settings", "Review & publish"]} current={step} />
        {step === 0 && <section><p className="eyebrow">START WITH THE STORY</p><div className="form-grid">{field("title", "Film title", "A title worth remembering")}<label className="form-field"><span>Category</span><select required value={form.category} onChange={(e) => update("category", e.target.value)}><option value="">Choose a category</option>{(categories.data || []).map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}</select></label><label className="form-field full"><span>Synopsis</span><textarea rows={5} required minLength={10} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="What is the story you want to tell?" /></label>{field("genre", "Genre", "Drama, Documentary…")}{field("region", "Country / region", "Ghana")}{field("language", "Language", "English, Swahili…")}</div></section>}
        {step === 1 && <section><p className="eyebrow">BRING YOUR STORY TO LIFE</p><p className="reel-category-help">Upload a file directly or paste a link. You can add the full film now or return to it later in My Films.</p><div className="form-grid">
          {(["posterUrl", "trailerUrl", "videoUrl"] as const).map((key) => {
            const label = key === "posterUrl" ? "Poster image" : key === "trailerUrl" ? "Trailer" : "Full film";
            const accept = key === "posterUrl" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm,video/quicktime";
            return <div className="media-upload" key={key}>
              {field(key, `${label} link`, "https://…")}
              <label className="file-picker"><span><Upload size={14} />{uploading === key ? "Uploading…" : `Choose ${label.toLowerCase()} file`}</span><input type="file" accept={accept} disabled={uploading !== null} onChange={(event) => { void upload(key, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
              <small>{key === "posterUrl" ? "JPEG, PNG, WebP · max 10 MB" : "MP4, WebM, QuickTime · max 500 MB"}</small>
              {uploads[key] && <UploadFileStatus upload={uploads[key]} />}
            </div>;
          })}
        </div><p className="form-hint">Large files may take a few minutes on mobile data. Keep this page open until the upload completes.</p></section>}
        {step === 2 && <section><p className="eyebrow">HOW AUDIENCES CAN WATCH</p><div className="form-grid">
          <label className="form-field"><span>Access model</span><select value={form.monetization} onChange={(e) => update("monetization", e.target.value)}><option value="subscription">Subscription</option><option value="free">Free</option><option value="ad_supported">Ad-supported</option><option value="pay_per_view">Pay per view</option></select></label>
          {form.monetization === "pay_per_view" && field("price", "Ticket price (KES)", "500", "number")}
          {field("director", "Director", "Director name")}{field("duration", "Runtime (minutes)", "e.g. 98", "number")}{field("cast", "Cast", "Names, separated by commas")}
        </div></section>}
        {step === 3 && <section className="upload-review"><p className="eyebrow">YOUR RELEASE</p><h2>{form.title}</h2><p>{form.description}</p><dl><div><dt>Category</dt><dd>{categories.data?.find((item) => item.slug === form.category)?.name || form.category}</dd></div><div><dt>Access</dt><dd>{form.monetization.replaceAll("_", " ")}{form.monetization === "pay_per_view" && form.price ? ` · KES ${form.price}` : ""}</dd></div><div><dt>Poster</dt><dd>{form.posterUrl ? uploads.posterUrl?.name || "Added" : "Not added"}</dd></div><div><dt>Trailer</dt><dd>{form.trailerUrl ? uploads.trailerUrl?.name || "Added" : "Not added"}</dd></div><div><dt>Full film</dt><dd>{form.videoUrl ? uploads.videoUrl?.name || "Added" : "Not added yet"}</dd></div></dl><p className="reel-category-help">Your release will be sent to the platform for review. You can manage it later from My Films.</p></section>}
        <div className="form-actions wizard-actions">{step > 0 && <button type="button" className="button button-glass" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={15} />Back</button>}{step === 0 && <Link href="/creator/films" className="button button-glass">Cancel</Link>}<button className="button button-gold" disabled={busy || uploading !== null}>{busy ? "Publishing…" : step === 3 ? "Submit release" : "Continue"}{step === 3 ? <Upload size={15} /> : <ArrowRight size={15} />}</button></div>
      </div>
    </form>
  </CreatorLayout>;
}

function CreatorAnalytics() {
  const state = useLoad<Record<string, unknown>>("creator/analytics");
  const data = state.data || {};
  const byDay = Array.isArray(data.viewsByDay) ? data.viewsByDay as { date: string; views: number }[] : [];
  const max = Math.max(1, ...byDay.map((item) => Number(item.views || 0)));
  return <CreatorLayout><PageTitle eyebrow="CREATOR STUDIO" title="Know your audience." description="A clearer picture of who's spending time with your stories." />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}{state.loading ? <Loading label="Loading your audience data…" /> : <>
      <div className="stat-grid five"><StatCard label="Total watch time" value={formatDuration(Number(data.totalWatchTime || 0) * 60)} icon={Clock3} /><StatCard label="Avg. completion" value={`${Number(data.avgWatchThroughRate || 0)}%`} icon={TrendingUp} /><StatCard label="Audience rating" value={typeof data.avgRating === "number" ? data.avgRating.toFixed(1) : "—"} icon={Star} /><StatCard label="Film plays" value={Number(data.totalViews || 0).toLocaleString()} icon={Eye} /><StatCard label="Unique viewers" value={Number(data.uniqueViewers || 0).toLocaleString()} icon={Users} /></div>
      <div className="dashboard-columns"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">LAST 30 DAYS</p><h2>Film engagement</h2></div></div>{byDay.some((item) => item.views > 0) ? <div className="bar-chart large">{byDay.map((item) => <div className="bar-column" key={item.date} title={`${item.date}: ${item.views} plays`}><i style={{ height: `${Math.max(4, Number(item.views) / max * 100)}%` }} /><small>{new Date(`${item.date}T00:00:00`).getDate()}</small></div>)}</div> : <div className="chart-placeholder"><BarChart3 size={22} />Real viewing activity will appear here when audiences play your films.</div>}</article>
        <article className="panel chart-placeholder">Unique viewers are counted from distinct, registered audience accounts. Demo accounts are excluded.</article></div>
    </>}</CreatorLayout>;
}

function CreatorEarnings() {
  const state = useLoad<Record<string, unknown>>("creator/earnings");
  const data = state.data || {};
  const history = Array.isArray(data.withdrawals) ? data.withdrawals as { id: number; amount: number; method: string; status: string; createdAt: string }[] : [];
  const revenue = Array.isArray(data.revenueByCurrency) ? data.revenueByCurrency as { currency: string; total: number; verifiedTransactions: number }[] : [];
  return <CreatorLayout><PageTitle eyebrow="CREATOR STUDIO" title="Earnings & payouts." description="Revenue reporting will be available once platform payments are connected." action={<button className="button button-glass" disabled title="Payouts are not configured"><Wallet size={15} />Payouts unavailable</button>} />
    {state.error && <Notice message={state.error} onRetry={state.reload} />}
    {state.loading ? <Loading label="Loading earnings…" /> : <>
      <div className="stat-grid three"><StatCard label="Available balance" value="Unavailable" icon={Wallet} /><StatCard label="Pending clearing" value="Unavailable" icon={Clock3} /><StatCard label="Verified revenue" value={revenue.map((item) => `${item.currency} ${item.total.toLocaleString()}`).join(" · ") || "Unavailable"} icon={CircleDollarSign} /></div>
      <section className="panel revenue-panel"><div className="panel-heading"><div><p className="eyebrow">VERIFIED TRANSACTIONS</p><h2>{revenue.length ? "Recorded revenue" : "No payment records"}</h2></div></div><p className="muted panel-empty">{String(data.message || "Revenue uses verified payment transactions only. No estimates are shown.")}</p>{revenue.map((item) => <p className="muted panel-empty" key={item.currency}>{item.currency} {item.total.toLocaleString()} across {item.verifiedTransactions} verified transactions.</p>)}</section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PAYOUT ACTIVITY</p><h2>Recent withdrawals</h2></div></div>{history.length ? <div className="table-wrap"><table className="film-table"><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleDateString()}</td><td className="capitalize">{item.method.replaceAll("_", " ")}</td><td>KES {Number(item.amount).toLocaleString()}</td><td><span className="status-pill">{item.status}</span></td></tr>)}</tbody></table></div> : <p className="muted panel-empty">No payout activity. Payout requests are disabled until settlement processing is connected.</p>}</section>
    </>}</CreatorLayout>;
}

function NotFound() {
  return <PageFrame><div className="not-found"><p className="eyebrow">OUT OF FRAME</p><h1>We lost the story.</h1><p className="muted">The page you’re looking for is no longer on this reel.</p><Link href="/" className="button button-gold"><ArrowLeft size={15} />Back to home</Link></div></PageFrame>;
}

export default App;
