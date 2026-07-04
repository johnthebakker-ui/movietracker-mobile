import type { MediaSummary } from "./types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://movietracker-tan.vercel.app").replace(/\/$/, "");
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const genres = [
  { value: "", label: "Every genre" },
  { value: "kdrama", label: "K-Drama" },
  { value: "superhero", label: "Superhero" },
  { value: "28", label: "Action" },
  { value: "12", label: "Adventure" },
  { value: "16", label: "Animation" },
  { value: "35", label: "Comedy" },
  { value: "80", label: "Crime" },
  { value: "99", label: "Documentary" },
  { value: "18", label: "Drama" },
  { value: "10751", label: "Family" },
  { value: "14", label: "Fantasy" },
  { value: "27", label: "Horror" },
  { value: "9648", label: "Mystery" },
  { value: "10749", label: "Romance" },
  { value: "878", label: "Sci-Fi" },
  { value: "53", label: "Thriller" }
];

export const excludeGenreOptions = [
  { value: "anime", label: "Anime" },
  { value: "16", label: "Animation / cartoons" },
  { value: "superhero", label: "Superhero" },
  ...genres.filter(genre => genre.value && !["kdrama", "superhero", "16"].includes(genre.value))
];

export const countries = [
  { value: "", label: "Every country" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "KR", label: "South Korea" },
  { value: "JP", label: "Japan" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
  { value: "ES", label: "Spain" },
  { value: "NL", label: "Netherlands" }
];

export function tmdbImage(path: string | null | undefined, size: "w342" | "w500" | "w780" | "original" = "w500") {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function titleYear(item: Pick<MediaSummary, "releaseDate" | "endDate" | "kind" | "status">) {
  const start = item.releaseDate?.slice(0, 4);
  const end = item.endDate?.slice(0, 4);
  const status = item.status?.toLowerCase() ?? "";
  const ended = status.includes("ended") || status.includes("canceled") || status.includes("cancelled");
  if (item.kind === "show" && start && ended) return `${start}${end && end !== start ? `-${end}` : ""} - Ended`;
  if (item.kind === "show" && start) return `${start}-`;
  return start || "TBA";
}

export function ratingLabel(item: MediaSummary) {
  if (typeof item.communityRating === "number" && item.communityRatingCount) return `${item.communityRating.toFixed(1)}/10`;
  return item.voteAverage ? `${item.voteAverage.toFixed(1)}/10` : "New";
}

export function userRatingLabel(item: MediaSummary) {
  return typeof item.userRating === "number" ? `${item.userRating.toFixed(1)}/10` : null;
}
