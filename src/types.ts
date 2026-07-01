export type MediaKind = "movie" | "show";
export type AppTab = "home" | "discover" | "calendar" | "library" | "profile";

export interface Genre {
  id: number;
  name: string;
}

export interface MediaSummary {
  id: number;
  kind: MediaKind;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  endDate?: string | null;
  status?: string | null;
  voteAverage: number;
  voteCount: number;
  communityRating?: number | null;
  communityRatingCount?: number;
  userRating?: number | null;
  popularity: number;
  genres: Genre[];
  collectionTmdbId?: number | null;
  collectionName?: string | null;
  originalLanguage?: string | null;
  originCountries?: string[];
  companies?: Array<{ id?: number; name: string; logo_path?: string | null }>;
  raw?: Record<string, any> | null;
  reason?: string;
}

export interface FeedResult {
  items: MediaSummary[];
  page?: number;
  totalPages?: number;
  nextCursor?: number | null;
  exhausted?: boolean;
}

export interface DiscoverFilters {
  kind: "all" | MediaKind;
  genre: string;
  country: string;
  yearMode?: "exact" | "range";
  year: string;
  fromYear?: string;
  toYear?: string;
  sort: "popularity" | "rating" | "newest";
  excludeGenres: string[];
  hideWatched: boolean;
  hideListed: boolean;
  view?: "trending" | "films" | "series";
}

export interface RecommendationFilters {
  kind: "all" | MediaKind;
  genre: string;
  country: string;
  yearMode?: "exact" | "range";
  year: string;
  fromYear?: string;
  toYear?: string;
  hideWatched: boolean;
  hideListed: boolean;
  excludeGenres: string[];
}
