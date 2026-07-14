import type { MediaSummary } from "./types";

export type UpNextEntry = {
  item: MediaSummary;
  label: string;
  reason: string;
  runtime?: number | null;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string | null;
  airDate?: string | null;
};

export function episodeTargetForUpNext(entry: UpNextEntry) {
  if (entry.item.kind !== "show" || entry.seasonNumber == null || entry.episodeNumber == null) return null;
  return {
    show: entry.item,
    seasonNumber: entry.seasonNumber,
    episodeNumber: entry.episodeNumber,
    title: entry.episodeTitle,
    airDate: entry.airDate,
    artwork: entry.item.backdropPath ?? entry.item.posterPath,
    runtime: entry.runtime
  };
}
