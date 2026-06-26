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
  popularity: number;
  genres: Genre[];
  originalLanguage?: string | null;
  originCountries?: string[];
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
  year: string;
  sort: "popularity" | "rating" | "newest";
  excludeGenres: string[];
}

export interface RecommendationFilters {
  kind: "all" | MediaKind;
  genre: string;
  country: string;
  year: string;
  hideWatched: boolean;
  hideListed: boolean;
  excludeGenres: string[];
}
