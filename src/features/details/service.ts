import type { DetailSeason } from "../../app/types";
import { firstRow } from "../../app/media-model";
import { supabase } from "../../supabase";
import type { MediaSummary } from "../../types";
import { completedRewatchProgress, scopeViewingPassEvents, seriesViewingSummary, viewingPassProgress } from "../../viewing-passes";

const endedSeriesStatuses = new Set(["Ended", "Canceled", "Cancelled"]);
export function isLimitedSeries(show: Pick<MediaSummary, "status">, seasons: DetailSeason[]) {
  return endedSeriesStatuses.has(show.status ?? "") && seasons.filter(season => season.seasonNumber > 0).length === 1;
}

const titleDetailCachePrefix = "movietracker-title-detail-v2";

export function titleDetailCacheKey(item: MediaSummary, userId?: string | null) {
  return `${titleDetailCachePrefix}:${userId ?? "guest"}:${item.kind}:${item.id}`;
}

export async function reconcileMobileEpisodeProgress(userId: string, mediaId: number) {
  if (!supabase) return;
  const [currentResult, mediaResult, watchesResult, seasonsResult] = await Promise.all([
    supabase.from("progress").select("status,completed_at,started_at,viewing_pass_started_at,viewing_pass_start_event_id").eq("user_id", userId).eq("media_id", mediaId).maybeSingle(),
    supabase.from("media").select("status,number_of_episodes").eq("id", mediaId).maybeSingle(),
    supabase.from("watch_events").select("id,episode_id,watched_at,created_at").eq("user_id", userId).eq("media_id", mediaId).not("episode_id", "is", null),
    supabase.from("seasons").select("season_number,episodes(id,episode_number)").eq("media_id", mediaId).gt("season_number", 0)
  ]);
  if (currentResult.error) throw currentResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (watchesResult.error) throw watchesResult.error;
  if (seasonsResult.error) throw seasonsResult.error;
  const episodes = (seasonsResult.data ?? []).flatMap((season: any) => (season.episodes ?? []).map((episode: any) => ({ id: Number(episode.id), seasonNumber: Number(season.season_number), episodeNumber: Number(episode.episode_number) }))).sort((left: any, right: any) => left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber);
  const ended = endedSeriesStatuses.has(String(mediaResult.data?.status ?? ""));
  const events = (watchesResult.data ?? []).map((watch: any) => ({ id: watch.id, episodeId: Number(watch.episode_id), watchedAt: watch.watched_at, createdAt: watch.created_at }));
  const passEvents = currentResult.data?.status === "completed"
    ? events
    : scopeViewingPassEvents(episodes, events, currentResult.data?.viewing_pass_start_event_id, currentResult.data?.viewing_pass_started_at);
  const pass = viewingPassProgress(episodes, passEvents, ended);
  if (!(watchesResult.data ?? []).length) {
    if (currentResult.data?.status === "completed" || currentResult.data?.status === "watching") {
      const { error } = await supabase.from("progress").delete().eq("user_id", userId).eq("media_id", mediaId).in("status", ["completed", "watching"]);
      if (error) throw error;
    }
    return;
  }
  if (currentResult.data?.status === "completed") {
    // Completed remains permanent. Rewatch progress is derived from event order;
    // moving completed_at here would hide older/imported rewatch events.
    return;
  }
  const status = ended && (watchesResult.data ?? []).length > 0 && pass.completedPasses > 0 && pass.nextIndex == null ? "completed" : "watching";
  if (currentResult.data?.status === status) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("progress").upsert({
    user_id: userId,
    media_id: mediaId,
    status,
    completed_at: status === "completed" ? now : null,
    updated_at: now
  });
  if (error) throw error;
}

export async function loadMobileSeriesViewingSummary(userId: string, mediaId: number, status?: string | null) {
  if (!supabase) return null;
  const [progressResult, seasonsResult, watchesResult] = await Promise.all([
    supabase.from("progress").select("status,completed_at,started_at,viewing_pass_started_at,viewing_pass_start_event_id").eq("user_id", userId).eq("media_id", mediaId).maybeSingle(),
    supabase.from("seasons").select("season_number,episodes(id,episode_number)").eq("media_id", mediaId).gt("season_number", 0),
    supabase.from("watch_events").select("id,episode_id,watched_at,created_at").eq("user_id", userId).eq("media_id", mediaId).not("episode_id", "is", null)
  ]);
  if (progressResult.error || seasonsResult.error || watchesResult.error) return null;
  const episodes = (seasonsResult.data ?? [])
    .flatMap((season: any) => (season.episodes ?? []).map((episode: any) => ({ id: Number(episode.id), seasonNumber: Number(season.season_number), episodeNumber: Number(episode.episode_number) })))
    .sort((left: any, right: any) => left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber);
  const events = (watchesResult.data ?? []).map((watch: any) => ({ id: watch.id, episodeId: Number(watch.episode_id), watchedAt: watch.watched_at, createdAt: watch.created_at }));
  const progress = progressResult.data;
  return seriesViewingSummary(episodes, events, progress ? {
    status: progress.status,
    completedAt: progress.completed_at,
    startedAt: progress.started_at,
    viewingPassStartedAt: progress.viewing_pass_started_at,
    viewingPassStartEventId: progress.viewing_pass_start_event_id
  } : null, endedSeriesStatuses.has(status ?? ""));
}

export async function loadMobileActiveRewatchIds(userId: string, rows: any[]) {
  if (!supabase) return new Set<number>();
  const completed = rows.flatMap(row => {
    const media = firstRow(row.media);
    return row.status === "completed" && media?.kind === "show" && media?.id ? [{ mediaId: Number(media.id), completedAt: row.completed_at ?? null, startedAt: row.started_at ?? null }] : [];
  });
  if (!completed.length) return new Set<number>();
  const ids = completed.map(row => row.mediaId);
  const [seasonsResult, watchesResult] = await Promise.all([
    supabase.from("seasons").select("media_id,season_number,episodes(id,episode_number)").in("media_id", ids).gt("season_number", 0),
    supabase.from("watch_events").select("media_id,episode_id,watched_at,created_at").eq("user_id", userId).in("media_id", ids).not("episode_id", "is", null)
  ]);
  if (seasonsResult.error) throw seasonsResult.error;
  if (watchesResult.error) throw watchesResult.error;
  const episodesByMedia = new Map<number, any[]>();
  for (const season of seasonsResult.data ?? []) {
    const mediaId = Number(season.media_id);
    episodesByMedia.set(mediaId, [...(episodesByMedia.get(mediaId) ?? []), ...(season.episodes ?? []).map((episode: any) => ({ id: Number(episode.id), seasonNumber: Number(season.season_number), episodeNumber: Number(episode.episode_number) }))]);
  }
  for (const episodes of episodesByMedia.values()) episodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  const watchesByMedia = new Map<number, any[]>();
  for (const watch of watchesResult.data ?? []) watchesByMedia.set(Number(watch.media_id), [...(watchesByMedia.get(Number(watch.media_id)) ?? []), watch]);
  const active = new Set<number>();
  for (const row of completed) {
    const allWatches = watchesByMedia.get(row.mediaId) ?? [];
    const rewatch = completedRewatchProgress(episodesByMedia.get(row.mediaId) ?? [], allWatches.map(watch => ({ episodeId: Number(watch.episode_id), watchedAt: watch.watched_at, createdAt: watch.created_at })), row.completedAt, row.startedAt);
    if (rewatch.active) active.add(row.mediaId);
  }
  return active;
}
