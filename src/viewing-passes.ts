export type ViewingPassEpisode = { id: number; seasonNumber: number; episodeNumber: number };
export type ViewingPassEvent = { id?: string | null; episodeId: number | null; watchedAt?: string | null; createdAt?: string | null };
export type SeriesViewingSummary = {
  label: "Rewatching" | "Completed" | "Paused" | "Dropped" | "Watching";
  watched: number;
  total: number;
  nextSeasonNumber: number | null;
  nextEpisodeNumber: number | null;
  rewatching: boolean;
};

function orderedViewingEvents(episodes: ViewingPassEpisode[], events: ViewingPassEvent[]) {
  const episodeIndex = new Map(episodes.map((episode, index) => [Number(episode.id), index]));
  return events.map((event, inputIndex) => ({ ...event, inputIndex, episodeIndex: event.episodeId == null ? null : episodeIndex.get(Number(event.episodeId)) }))
    .filter((event): event is typeof event & { episodeIndex: number } => event.episodeIndex != null)
    .sort((left, right) => {
      const leftTime = Date.parse(left.watchedAt ?? left.createdAt ?? "");
      const rightTime = Date.parse(right.watchedAt ?? right.createdAt ?? "");
      const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
      const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
      if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
      const leftCreated = Date.parse(left.createdAt ?? "");
      const rightCreated = Date.parse(right.createdAt ?? "");
      if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) return leftCreated - rightCreated;
      if (left.episodeIndex !== right.episodeIndex) return left.episodeIndex - right.episodeIndex;
      return left.inputIndex - right.inputIndex;
    });
}

export function scopeViewingPassEvents(episodes: ViewingPassEpisode[], events: ViewingPassEvent[], startEventId?: string | null, startedAt?: string | null) {
  if (!startEventId && !startedAt) return events;
  const ordered = orderedViewingEvents(episodes, events);
  const boundaryIndex = startEventId ? ordered.findIndex(event => event.id === startEventId) : -1;
  if (boundaryIndex >= 0) return ordered.slice(boundaryIndex);
  const boundaryTime = Date.parse(startedAt ?? "");
  if (!Number.isFinite(boundaryTime)) return events;
  return ordered.filter(event => {
    const eventTime = Date.parse(event.watchedAt ?? event.createdAt ?? "");
    return Number.isFinite(eventTime) && eventTime >= boundaryTime;
  });
}

export function viewingPassProgress(episodes: ViewingPassEpisode[], events: ViewingPassEvent[], seriesComplete = true) {
  if (!episodes.length) return { nextIndex: null as number | null, completedPasses: 0, activeEpisodeIds: [] as number[] };
  const ordered = orderedViewingEvents(episodes, events);
  let cursor = -1;
  let completedPasses = 0;
  let active = false;
  const activeEpisodeIds = new Set<number>();
  for (const event of ordered) {
    if (!active) { cursor = event.episodeIndex; active = true; activeEpisodeIds.clear(); }
    else cursor = Math.max(cursor, event.episodeIndex);
    activeEpisodeIds.add(Number(event.episodeId));
    if (seriesComplete && cursor >= episodes.length - 1) { completedPasses += 1; cursor = -1; active = false; activeEpisodeIds.clear(); }
  }
  if (!ordered.length) return { nextIndex: 0, completedPasses: 0, activeEpisodeIds: [] as number[] };
  return { nextIndex: active ? cursor + 1 : null, completedPasses, activeEpisodeIds: [...activeEpisodeIds] };
}

export function completedRewatchProgress(episodes: ViewingPassEpisode[], events: ViewingPassEvent[], completedAt?: string | null, startedAt?: string | null) {
  const completedTime = completedAt ? Date.parse(completedAt) : Number.NaN;
  const startedTime = startedAt ? Date.parse(startedAt) : Number.NaN;
  const hasCycleBoundary = Number.isFinite(startedTime) && (!Number.isFinite(completedTime) || startedTime > completedTime);
  const scopedEvents = hasCycleBoundary ? events.filter(event => {
    const eventTime = Date.parse(event.watchedAt ?? event.createdAt ?? "");
    return Number.isFinite(eventTime) && eventTime > startedTime;
  }) : events;
  const progress = viewingPassProgress(episodes, scopedEvents, true);
  return { ...progress, scopedEvents, hasCycleBoundary, active: hasCycleBoundary ? scopedEvents.length > 0 && progress.nextIndex != null : progress.completedPasses > 0 && progress.nextIndex != null };
}

export function seriesViewingSummary(
  episodes: ViewingPassEpisode[],
  events: ViewingPassEvent[],
  progress: {
    status?: string | null;
    completedAt?: string | null;
    startedAt?: string | null;
    viewingPassStartedAt?: string | null;
    viewingPassStartEventId?: string | null;
  } | null,
  seriesEnded: boolean
): SeriesViewingSummary | null {
  const status = progress?.status ?? null;
  const completed = status === "completed";
  const hasExplicitPass = Boolean(progress?.viewingPassStartEventId || progress?.viewingPassStartedAt);
  const rewatch = completed && !hasExplicitPass ? completedRewatchProgress(episodes, events, progress?.completedAt, progress?.startedAt) : null;
  const explicitPassEvents = hasExplicitPass ? scopeViewingPassEvents(episodes, events, progress?.viewingPassStartEventId, progress?.viewingPassStartedAt) : events;
  const pass = rewatch ?? viewingPassProgress(episodes, explicitPassEvents, seriesEnded);
  const rewatching = Boolean(rewatch?.active) || (hasExplicitPass && explicitPassEvents.length > 0 && pass.nextIndex != null);
  const watched = rewatching
    ? new Set(pass.activeEpisodeIds).size
    : completed
      ? episodes.length
      : new Set(explicitPassEvents.flatMap(event => event.episodeId == null ? [] : [Number(event.episodeId)])).size;
  const next = pass.nextIndex == null ? null : episodes[pass.nextIndex] ?? null;
  const label = rewatching
    ? "Rewatching"
    : completed
      ? "Completed"
      : status === "paused"
        ? "Paused"
        : status === "dropped"
          ? "Dropped"
          : explicitPassEvents.length || status === "watching"
            ? "Watching"
            : null;
  if (!label) return null;
  return {
    label,
    watched,
    total: episodes.length,
    nextSeasonNumber: next?.seasonNumber ?? null,
    nextEpisodeNumber: next?.episodeNumber ?? null,
    rewatching
  };
}
