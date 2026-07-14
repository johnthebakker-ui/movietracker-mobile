export type ViewingPassEpisode = { id: number; seasonNumber: number; episodeNumber: number };
export type ViewingPassEvent = { episodeId: number | null; watchedAt?: string | null; createdAt?: string | null };

export function viewingPassProgress(episodes: ViewingPassEpisode[], events: ViewingPassEvent[], seriesComplete = true) {
  if (!episodes.length) return { nextIndex: null as number | null, completedPasses: 0 };
  const episodeIndex = new Map(episodes.map((episode, index) => [Number(episode.id), index]));
  const ordered = events.map((event, inputIndex) => ({ ...event, inputIndex, episodeIndex: event.episodeId == null ? null : episodeIndex.get(Number(event.episodeId)) }))
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
  let cursor = -1;
  let completedPasses = 0;
  let active = false;
  for (const event of ordered) {
    if (!active) { cursor = event.episodeIndex; active = true; }
    else cursor = Math.max(cursor, event.episodeIndex);
    if (seriesComplete && cursor >= episodes.length - 1) { completedPasses += 1; cursor = -1; active = false; }
  }
  if (!ordered.length) return { nextIndex: 0, completedPasses: 0 };
  return { nextIndex: active ? cursor + 1 : null, completedPasses };
}
