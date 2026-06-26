import { API_URL } from "./config";
import type { DiscoverFilters, FeedResult, MediaSummary, RecommendationFilters } from "./types";

function queryString(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  });
  return params.toString();
}

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${response.status})`);
  return json as T;
}

function normalizeRecommendations(data: { items?: Array<{ item?: MediaSummary; reason?: string } | MediaSummary>; nextCursor?: number | null; exhausted?: boolean }): FeedResult {
  return {
    items: (data.items || []).map(entry => {
      if ("item" in entry && entry.item) return { ...entry.item, reason: entry.reason };
      return entry as MediaSummary;
    }),
    nextCursor: data.nextCursor ?? null,
    exhausted: Boolean(data.exhausted)
  };
}

export async function fetchDiscover(filters: DiscoverFilters, page = 1): Promise<FeedResult> {
  const query = queryString({
    kind: filters.kind,
    genre: filters.genre,
    country: filters.genre === "kdrama" ? undefined : filters.country,
    yearMode: filters.year ? "exact" : undefined,
    year: filters.year,
    excludeGenres: filters.excludeGenres.join(","),
    sort: filters.sort === "rating" ? "vote_average.desc" : filters.sort === "newest" ? "newest" : "popularity.desc",
    page
  });
  return request<FeedResult>(`/api/discover?${query}`);
}

export async function fetchRecommendations(filters: RecommendationFilters, token: string, cursor = 0): Promise<FeedResult> {
  const query = queryString({
    kind: filters.kind === "all" ? undefined : filters.kind,
    genre: filters.genre,
    country: filters.genre === "kdrama" ? undefined : filters.country,
    year: filters.year,
    excludeGenres: filters.excludeGenres.join(","),
    hideWatched: filters.hideWatched ? "1" : "0",
    hideListed: filters.hideListed ? "1" : "0",
    cursor
  });
  return normalizeRecommendations(await request(`/api/recommendations?${query}`, token));
}

export async function refreshRecommendations(token: string) {
  return request<{ refreshed: boolean }>("/api/recommendations/refresh", token, { method: "POST" });
}

export async function setNotInterested(item: MediaSummary, token: string) {
  return request<{ dismissed: boolean }>("/api/recommendations/interest", token, {
    method: "POST",
    body: JSON.stringify({ tmdbId: item.id, kind: item.kind })
  });
}
