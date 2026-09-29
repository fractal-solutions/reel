export interface Film {
  id: number;
  title: string;
  description: string | null;
  posterUrl: string | null;
  trailerUrl?: string | null;
  videoUrl?: string | null;
  duration: number | null;
  genre?: string | null;
  category: string | null;
  region: string | null;
  language?: string | null;
  rating: number | null;
  reviewCount?: number;
  viewCount: number;
  monetization: string;
  price?: number | null;
  isFestivalWinner: boolean;
  isFeatured: boolean;
  tags: string[];
  watchProgress?: number | null;
  creatorId?: number;
  creatorName?: string | null;
  cast?: string | null;
  director?: string | null;
  subtitles?: string[];
  status?: string;
  createdAt: string;
  isInWatchlist?: boolean;
};

export interface Review {
  id: number;
  rating: number;
  comment: string | null;
  userName?: string | null;
  createdAt: string;
}

export interface ProgressItem {
  id: number;
  filmId: number;
  progressSeconds: number;
  totalSeconds: number | null;
  percentComplete: number;
  film: Film;
}

export interface Category {
  id?: number;
  name: string;
  slug: string;
}

export interface Plan {
  id: number;
  name: string;
  priceMonthly: number;
  features: string[];
}

export interface FilmList {
  films: Film[];
  total: number;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path.startsWith("/api/") ? path : `/api/${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
