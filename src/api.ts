import { API_URL } from "./config";
import type { DiscoverFilters, FeedResult, MediaSummary, RecommendationFilters } from "./types";

export type HomePayload = {
  hero: MediaSummary[];
  sections: Array<{ kicker: string; title: string; items: MediaSummary[] }>;
};

export type MobileTitlePayload = {
  completeness?: "core" | "full";
  dbId: number | null;
  overview: string | null;
  tagline: string | null;
  releaseDate: string | null;
  endDate: string | null;
  genres: Array<{ id?: number; name: string }>;
  voteAverage: number | null;
  runtime: number | null;
  originalLanguage: string | null;
  status: string | null;
  userRating: number | null;
  communityRating: number | null;
  externalRatings: Array<{ label: string; value: string }>;
  pendingExternalRatingSources?: string[];
  progressStatus: string | null;
  favorite: boolean;
  watched?: boolean;
  lastWatchedAt?: string | null;
  notInterested?: boolean;
  lists: Array<{ id: string; name: string; description?: string | null; visibility?: string | null; count?: number; posters?: string[]; contains: boolean }>;
  cast: any[];
  crew: any[];
  companies: any[];
  videos: any[];
  images: any[];
  seasons: any[];
  reviews: any[];
  myReview: any | null;
  collectionName: string | null;
  collection: MediaSummary[];
  recommendations: MediaSummary[];
};

export type MobileEntityPayload = {
  person?: any;
  company?: any;
  items?: MediaSummary[];
  kind?: MediaSummary["kind"];
  page?: number;
  totalPages?: number;
  movies?: FeedResult;
  shows?: FeedResult;
};

export type MobileEpisodePayload = {
  show: MediaSummary;
  mediaId: number | null;
  seasonId: number | null;
  episodeId: number | null;
  season: any;
  episode: any;
  userRating: number | null;
  communityRating: number | null;
  watched: boolean;
  lastWatchedAt?: string | null;
  reviews: any[];
  myReview: any | null;
  externalRatings: Array<{ label: string; value: string }>;
  companies?: any[];
  recommendations: MediaSummary[];
};

export type MobileSeasonPayload = {
  show: MediaSummary;
  mediaId: number | null;
  seasonId: number | null;
  userRating: number | null;
  communityRating: number | null;
  tmdbRating: number | null;
  imdbRating: number | null;
  reviews: any[];
  myReview: any | null;
  season: any;
  episodes: any[];
  imdbRatings: Array<{ episode: number; title: string; released?: string; imdbRating: number | null; imdbId?: string }>;
};

export type MobileTraktStatus = {
  databaseReady: boolean;
  environmentReady: boolean;
  connection: { trakt_username?: string | null; sync_enabled?: boolean; last_synced_at?: string | null; last_error?: string | null; updated_at?: string | null } | null;
};

function queryString(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  });
  return params.toString();
}

const inflightGets = new Map<string, Promise<unknown>>();

async function executeRequest<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers || {})
        }
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(typeof json?.error === "string" ? json.error : `Request failed (${response.status})`);
        if (attempt + 1 < attempts && [408, 429, 500, 502, 503, 504].includes(response.status)) { lastError = error; continue; }
        throw error;
      }
      return json as T;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) throw error instanceof Error && error.name === "AbortError" ? new Error("Request timed out. Check your connection and try again.") : error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return executeRequest(path, token, init);
  const key = `${token ?? "guest"}:${path}`;
  const existing = inflightGets.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = executeRequest<T>(path, token, init).finally(() => inflightGets.delete(key));
  inflightGets.set(key, pending);
  return pending;
}

async function requestText(path: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "Cache-Control": "no-cache", "User-Agent": "MovieTrackerMobile/1.0" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return text;
  } finally { clearTimeout(timer); }
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

export async function fetchDiscover(filters: DiscoverFilters, page = 1, token?: string): Promise<FeedResult> {
  const yearMode = filters.yearMode === "range" ? "range" : "exact";
  const query = queryString({
    kind: filters.kind,
    genre: filters.genre,
    country: filters.genre === "kdrama" ? undefined : filters.country,
    yearMode: yearMode === "range" || filters.year ? yearMode : undefined,
    year: yearMode === "exact" ? filters.year : undefined,
    fromYear: yearMode === "range" ? filters.fromYear : undefined,
    toYear: yearMode === "range" ? filters.toYear : undefined,
    excludeGenres: filters.excludeGenres.join(","),
    sort: filters.sort === "rating" ? "vote_average.desc" : filters.sort === "newest" ? "newest" : "popularity.desc",
    hideWatched: filters.hideWatched ? "1" : "0",
    hideListed: filters.hideListed ? "1" : "0",
    view: filters.view,
    page
  });
  return request<FeedResult>(`/api/discover?${query}`, token);
}

export async function fetchSearch(query: string, token?: string): Promise<FeedResult> {
  const params = queryString({ q: query });
  return request<FeedResult>(`/api/mobile/search?${params}`, token);
}

export async function fetchWebsiteHome(token?: string): Promise<HomePayload> {
  return request<HomePayload>("/api/mobile/home", token);
}

export async function fetchRecommendations(filters: RecommendationFilters, token: string, cursor = 0): Promise<FeedResult> {
  const yearMode = filters.yearMode === "range" ? "range" : "exact";
  const query = queryString({
    kind: filters.kind === "all" ? undefined : filters.kind,
    genre: filters.genre,
    country: filters.genre === "kdrama" ? undefined : filters.country,
    yearMode: yearMode === "range" || filters.year ? yearMode : undefined,
    year: yearMode === "exact" ? filters.year : undefined,
    fromYear: yearMode === "range" ? filters.fromYear : undefined,
    toYear: yearMode === "range" ? filters.toYear : undefined,
    excludeGenres: filters.excludeGenres.join(","),
    hideWatched: filters.hideWatched ? "1" : "0",
    hideListed: filters.hideListed ? "1" : "0",
    cursor
  });
  return normalizeRecommendations(await request(`/api/recommendations?${query}`, token));
}

export async function fetchTraktStatus(token: string): Promise<MobileTraktStatus> {
  return request<MobileTraktStatus>("/api/mobile/integrations/trakt", token);
}

export async function startTraktConnect(token: string, redirectTo: string): Promise<{ url: string; redirectTo: string }> {
  return request<{ url: string; redirectTo: string }>("/api/mobile/integrations/trakt/connect", token, { method: "POST", body: JSON.stringify({ redirectTo }) });
}

export async function syncTrakt(token: string): Promise<{ skipped?: boolean; history?: number; ratings?: number; watchlist?: number; error?: string }> {
  return request("/api/mobile/integrations/trakt/sync?force=1", token, { method: "POST" });
}

export async function disconnectTrakt(token: string): Promise<{ success: boolean }> {
  return request("/api/mobile/integrations/trakt/disconnect", token, { method: "POST" });
}

export async function fetchMobileTitle(kind: MediaSummary["kind"], id: number, token?: string, mode?: "core" | "full") {
  const query = mode === "core" ? "?mode=core" : "";
  return request<MobileTitlePayload>(`/api/mobile/title/${kind}/${id}${query}`, token);
}

export async function fetchMobilePerson(id: number, token?: string) {
  return request<MobileEntityPayload>(`/api/mobile/person/${id}`, token);
}

export async function fetchMobileCompany(id: number, kind?: MediaSummary["kind"], page = 1, token?: string) {
  const query = kind ? `?${queryString({ kind, page })}` : "";
  return request<MobileEntityPayload>(`/api/mobile/company/${id}${query}`, token);
}

export async function fetchMobileEpisode(showId: number, season: number, episode: number, token?: string) {
  return request<MobileEpisodePayload>(`/api/mobile/episode/${showId}/season/${season}/episode/${episode}`, token);
}

export async function fetchMobileSeason(showId: number, season: number, token?: string) {
  return request<MobileSeasonPayload>(`/api/mobile/season/${showId}/${season}`, token);
}

export async function fetchEpisodeNotificationSchedule(token: string) {
  return request<{ events: Array<{ releaseKey: string; airDate: string; title: string; body: string; href: string; image: string | null }> }>("/api/mobile/notifications/schedule", token);
}

export async function sendTestNotification(token: string) {
  return request<{ created: boolean; pushed: number; href: string; notification: { releaseKey: string; title: string; message: string; href: string; image: string | null } }>("/api/mobile/notifications/test", token, { method: "POST" });
}

export async function deleteMobileNotifications(token: string, filter?: { id?: string; releaseKey?: string }) {
  const params = filter ? `?${queryString(filter)}` : "";
  return request<{ removed: boolean }>(`/api/mobile/notifications${params}`, token, { method: "DELETE" });
}

export async function fetchMobileProfile(token: string): Promise<any> {
  return request<any>("/api/mobile/profile", token);
}

export async function fetchMobileHistory(token: string, page = 1, type: "all" | "movies" | "episodes" = "all", query = "") {
  const params = queryString({ page, type, q: query.trim() });
  return request<{ items: any[]; page: number; pageSize: number; hasMore: boolean }>(`/api/mobile/history?${params}`, token);
}

export async function deleteMobileHistoryEvent(token: string, eventId: string) {
  return request<{ removed: boolean }>(`/api/mobile/history/${encodeURIComponent(eventId)}`, token, { method: "DELETE" });
}

export async function fetchTonight(filters: Record<string, string>, token?: string) {
  return request<any>(`/api/tonight?${queryString(filters)}`, token);
}

export async function fetchUpNext(token: string, minutes = 120) {
  return request<any>(`/api/up-next?minutes=${minutes}`, token);
}

export async function fetchWrapped(token: string, year = new Date().getFullYear()) {
  return request<any>(`/api/wrapped?year=${year}`, token);
}

export async function fetchWrappedShare(token: string) {
  return request<{ url: string }>("/api/wrapped/share", token, { method: "POST" });
}

export async function refreshRecommendations(token: string) {
  return request<{ refreshed: boolean }>("/api/recommendations/refresh", token, { method: "POST" });
}

export async function fetchWebsiteTitleRatings(kind: MediaSummary["kind"], id: number) {
  return (await fetchWebsiteTitleMetadata(kind, id)).ratings;
}

export async function fetchWebsiteTitleMetadata(kind: MediaSummary["kind"], id: number) {
  const payload = await request<MobileTitlePayload>(`/api/mobile/title/${kind}/${id}`);
  return { overview: payload.overview ?? "", ratings: payload.externalRatings ?? [], collectionTitle: payload.collectionName ?? undefined, collectionItems: payload.collection ?? [], recommendations: payload.recommendations ?? [] };
}

export async function fetchWebsiteEntityMetadata(type: "person" | "company", id: number) {
  const payload = await request<MobileEntityPayload>(`/api/mobile/${type}/${id}`);
  const entity = type === "person" ? payload.person : payload.company;
  const items = payload.items ?? payload.person?.credits ?? [...(payload.movies?.items ?? []), ...(payload.shows?.items ?? [])];
  return { title: entity?.name ?? "", bio: entity?.biography ?? entity?.description ?? "", items };
}

export async function setNotInterested(item: MediaSummary, token: string) {
  return request<{ dismissed: boolean }>("/api/recommendations/interest", token, {
    method: "POST",
    body: JSON.stringify({ tmdbId: item.id, kind: item.kind })
  });
}

function extractHeroItems(html: string) {
  const start = html.indexOf('"HomeHeroCarousel"');
  const itemStart = html.indexOf('\\"items\\":[', start);
  if (start < 0 || itemStart < 0) return [];
  const arrayStart = itemStart + '\\"items\\":'.length;
  const rawArray = readBalancedArray(html, arrayStart);
  if (!rawArray) return [];
  try {
    const json = rawArray.replace(/\\"/g, '"').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return (JSON.parse(json) as MediaSummary[]).map(item => ({ ...item, reason: undefined })).filter(item => item.id && item.title).slice(0, 6);
  } catch {
    return [];
  }
}

function readBalancedArray(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function extractHomeSections(html: string) {
  const sectionMatches = [...html.matchAll(/<section class="section">([\s\S]*?)(?=<\/section>)/g)];
  const sections = sectionMatches.map((match, index) => {
    const chunk = match[1];
    return {
      kicker: decodeHtml(matchText(chunk, /class="eyebrow">([^<]+)</) || defaultSection(index).kicker),
      title: decodeHtml(matchText(chunk, /<h2[^>]*>([^<]+)<\/h2>/) || defaultSection(index).title),
      items: extractCards(chunk)
    };
  }).filter(section => section.items.length);
  if (sections.length) return sections;

  const cards = extractCards(html);
  return [
    { kicker: "Everyone is watching", title: "Trending now", items: cards.slice(0, 12) },
    { kicker: "Fresh from the cinema", title: "New & upcoming films", items: cards.slice(12, 24) },
    { kicker: "Stories worth settling into", title: "Series premieres", items: cards.slice(24, 36) }
  ].filter(section => section.items.length);
}

function extractTitleRelatedSections(html: string) {
  const result: { collectionTitle?: string; collectionItems: MediaSummary[]; recommendations: MediaSummary[] } = { collectionItems: [], recommendations: [] };
  const sectionMatches = [...html.matchAll(/<section class="section[^"]*">([\s\S]*?)(?=<\/section>)/g)];
  for (const match of sectionMatches) {
    const chunk = match[1];
    const plain = decodeHtml(stripTags(chunk)).replace(/\s+/g, " ");
    const cards = extractCardsWithStreamed(html, chunk);
    if (!cards.length) continue;
    if (/Continue the collection/i.test(plain)) {
      result.collectionTitle = decodeHtml(stripTags(matchText(chunk, /<h2[^>]*>([\s\S]*?)<\/h2>/) || "")).trim();
      result.collectionItems = cards;
    }
    if (/If this stayed with you/i.test(plain)) result.recommendations = cards;
  }
  return result;
}

function extractCardsWithStreamed(html: string, chunk: string) {
  const resolved = [chunk];
  const ids = [...chunk.matchAll(/<template id="P:([^"]+)"><\/template>/g)].map(match => match[1]);
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const streamed = html.match(new RegExp(`<div hidden id="S:${escaped}">([\\s\\S]*?)<\\/div><script>\\$RS\\("S:${escaped}","P:${escaped}"\\)<\\/script>`))?.[1];
    if (streamed) resolved.push(streamed);
  }
  return extractCards(resolved.join(""));
}

function extractCards(html: string) {
  const items: MediaSummary[] = [];
  const seen = new Set<string>();
  const cardPattern = /<a href="\/title\/(movie|show)\/(\d+)">[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<div class="card-title truncate">([\s\S]*?)<\/div>[\s\S]*?<div class="card-meta"><span>([^<]*)<\/span><span>(Film|Series)<\/span><\/div>/g;
  for (const match of html.matchAll(cardPattern)) {
    const kind = match[1] === "show" ? "show" : "movie";
    const id = Number(match[2]);
    const key = `${kind}-${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id,
      kind,
      title: decodeHtml(stripTags(match[4])),
      overview: "",
      posterPath: stripImageHost(decodeHtml(match[3])),
      backdropPath: null,
      ...runLabelToDates(match[5], kind),
      voteAverage: 0,
      voteCount: 0,
      popularity: 0,
      genres: []
    });
  }
  return items;
}

function defaultSection(index: number) {
  return [
    { kicker: "Everyone is watching", title: "Trending now" },
    { kicker: "Fresh from the cinema", title: "New & upcoming films" },
    { kicker: "Stories worth settling into", title: "Series premieres" }
  ][index] ?? { kicker: "MovieTracker", title: "Browse" };
}

function matchText(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1] ?? "";
}

function stripImageHost(value: string) {
  return value.replace(/^https?:\/\/image\.tmdb\.org\/t\/p\/[^/]+/i, "");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function runLabelToDates(value: string, kind: MediaSummary["kind"]) {
  const start = value.match(/\b(\d{4})\b/)?.[1] ?? null;
  const ended = /\bended\b/i.test(value);
  const range = value.match(/\b(\d{4})-(\d{4})\b/);
  return {
    releaseDate: start ? `${start}-01-01` : null,
    endDate: kind === "show" && range?.[2] ? `${range[2]}-01-01` : null,
    status: kind === "show" ? ended ? "Ended" : start ? "Returning Series" : null : null
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeHtml(value: string) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizeRatingLabel(value: string) {
  const compact = value.toLowerCase().replace(/[^a-z]/g, "");
  if (compact === "imdb") return "IMDb";
  if (compact === "rottentomatoes") return "Rotten Tomatoes";
  if (compact === "metacritic") return "Metacritic";
  return value;
}

function extractExternalRatingsFallback(html: string) {
  const text = decodeHtml(stripTags(html)).replace(/\s+/g, " ");
  const candidates: Array<{ label: string; pattern: RegExp }> = [
    { label: "IMDb", pattern: /IMDb[\s\S]{0,120}?([0-9](?:\.[0-9])?\/10)/i },
    { label: "Rotten Tomatoes", pattern: /Rotten Tomatoes[\s\S]{0,120}?([0-9]{1,3}%)/i },
    { label: "Metacritic", pattern: /Metacritic[\s\S]{0,120}?([0-9]{1,3}\/100)/i }
  ];
  return candidates.flatMap(candidate => {
    const match = text.match(candidate.pattern);
    return match?.[1] ? [{ label: candidate.label, value: match[1] }] : [];
  });
}
