import type { ReviewItem } from "./types";
import type { MediaKind, MediaSummary } from "../types";

export function firstRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function trustedCommunityRating(item: Pick<MediaSummary, "communityRating" | "communityRatingCount">) {
  return typeof item.communityRating === "number" && Boolean(item.communityRatingCount) ? item.communityRating : null;
}

export function fromDbMedia(row: any, ratingByMedia?: Map<any, number>): MediaSummary {
  return {
    id: Number(row.tmdb_id),
    kind: row.kind,
    title: row.title,
    overview: row.overview ?? "",
    posterPath: row.poster_path ?? null,
    backdropPath: row.backdrop_path ?? null,
    releaseDate: row.release_date ?? null,
    endDate: row.end_date ?? null,
    status: row.status ?? null,
    voteAverage: Number(row.vote_average ?? 0),
    voteCount: Number(row.vote_count ?? 0),
    userRating: ratingByMedia?.get(row.id) ?? null,
    popularity: Number(row.popularity ?? 0),
    genres: row.genres ?? [],
    collectionTmdbId: row.collection_tmdb_id ?? row.raw?.belongs_to_collection?.id ?? null,
    collectionName: row.collection_name ?? row.raw?.belongs_to_collection?.name ?? null,
    originalLanguage: row.original_language ?? null,
    originCountries: row.origin_countries ?? [],
    companies: row.companies ?? row.raw?.production_companies ?? [],
    raw: row.raw ? { ...row.raw, keywords: row.keywords ?? row.raw.keywords } : row.keywords ? { keywords: row.keywords } : null
  };
}

export function mapProfileReview(review: any, ratingByMedia: Map<any, number>): ReviewItem[] {
  const directMedia = firstRow(review.media);
  const season = firstRow<any>(review.seasons);
  const seasonMedia = firstRow<any>(season?.media);
  const episode = firstRow<any>(review.episodes);
  const episodeSeason = firstRow<any>(episode?.seasons);
  const episodeMedia = firstRow<any>(episodeSeason?.media);
  const media: any = directMedia ?? seasonMedia ?? episodeMedia;
  if (!media) return [];

  const rating = firstRow<any>(review.ratings);
  const item = fromDbMedia(media, ratingByMedia);
  const seasonNumber = season?.season_number != null ? Number(season.season_number) : null;
  const episodeSeasonNumber = episodeSeason?.season_number != null ? Number(episodeSeason.season_number) : null;
  const episodeNumber = episode?.episode_number != null ? Number(episode.episode_number) : null;
  const targetLabel: ReviewItem["targetLabel"] = episode && episodeSeasonNumber != null && episodeNumber != null
    ? "episode"
    : season && seasonNumber != null
      ? "season"
      : undefined;

  return [{
    id: review.id,
    title: review.title || "Review",
    body: review.body ?? "",
    created_at: review.created_at,
    updated_at: review.updated_at,
    containsSpoilers: Boolean(review.contains_spoilers),
    isPrivate: Boolean(review.is_private),
    kind: media.kind,
    targetLabel,
    targetMeta: targetLabel === "episode"
      ? `S${episodeSeasonNumber} E${episodeNumber}${episode.name ? ` - ${episode.name}` : ""}`
      : targetLabel === "season"
        ? `Season ${seasonNumber}${season.name ? ` - ${season.name}` : ""}`
        : null,
    mediaTitle: media.title,
    artwork: episode?.still_path ?? season?.poster_path ?? media.backdrop_path ?? media.poster_path ?? null,
    score: typeof rating?.score === "number" ? rating.score : null,
    item,
    seasonTarget: targetLabel === "season" ? {
      show: item,
      season: {
        id: season.id != null ? Number(season.id) : undefined,
        seasonNumber: seasonNumber!,
        name: season.name ?? `Season ${seasonNumber}`,
        overview: season.overview ?? null,
        posterPath: season.poster_path ?? null,
        airDate: season.air_date ?? null,
        episodeCount: season.episode_count != null ? Number(season.episode_count) : null
      }
    } : null,
    episodeTarget: targetLabel === "episode" ? {
      show: item,
      episodeId: episode.id != null ? Number(episode.id) : undefined,
      seasonNumber: episodeSeasonNumber!,
      episodeNumber: episodeNumber!,
      title: episode.name ?? null,
      overview: episode.overview ?? null,
      airDate: episode.air_date ?? null,
      artwork: episode.still_path ?? media.backdrop_path ?? media.poster_path ?? null,
      runtime: episode.runtime != null ? Number(episode.runtime) : null,
      voteAverage: episode.vote_average != null ? Number(episode.vote_average) : null
    } : null
  }];
}

export function fromTmdbRaw(raw: any, forcedKind?: MediaKind): MediaSummary | null {
  if (!raw?.id) return null;
  const kind: MediaKind = forcedKind ?? (raw.media_type === "tv" || raw.name ? "show" : "movie");
  const genresFromIds = Array.isArray(raw.genre_ids) ? raw.genre_ids.map((id: number) => ({ id, name: String(id) })) : [];
  return {
    id: Number(raw.id),
    kind,
    title: raw.title ?? raw.name ?? "Untitled",
    overview: raw.overview ?? "",
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    releaseDate: raw.release_date ?? raw.first_air_date ?? null,
    endDate: raw.last_air_date ?? null,
    status: raw.status ?? null,
    voteAverage: Number(raw.vote_average ?? 0),
    voteCount: Number(raw.vote_count ?? 0),
    popularity: Number(raw.popularity ?? 0),
    genres: Array.isArray(raw.genres) ? raw.genres : genresFromIds,
    collectionTmdbId: raw.belongs_to_collection?.id ?? null,
    collectionName: raw.belongs_to_collection?.name ?? null,
    originalLanguage: raw.original_language ?? null,
    originCountries: raw.origin_country ?? (raw.production_countries ?? []).map((country: any) => country.iso_3166_1).filter(Boolean)
  };
}

export function progressLabel(status: string | null | undefined) {
  if (status === "planned") return "Watchlist";
  if (status === "watching") return "Watching";
  if (status === "completed") return "Completed";
  if (status === "paused") return "Paused";
  if (status === "dropped") return "Dropped";
  return "Tracked";
}

export function dedupeMedia(items: MediaSummary[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.kind}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

