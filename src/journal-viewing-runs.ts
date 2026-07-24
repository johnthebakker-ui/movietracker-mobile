export type JournalViewingEpisode = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
};

export type JournalViewingEvent = {
  id: string;
  watchedAt: string;
  label: string;
  episodeId: number | null;
  seasonId: number | null;
};

export type JournalViewingRun = {
  id: string;
  label: string;
  startAt: string;
  endAt: string | null;
  status: "finished" | "partial" | "ongoing";
  complete: boolean;
  events: JournalViewingEvent[];
};

const RESTART_GAP_MS = 6 * 60 * 60 * 1000;

export function buildJournalViewingRuns(events: JournalViewingEvent[], episodes: JournalViewingEpisode[]): JournalViewingRun[] {
  const dated = events
    .filter(event => Number.isFinite(Date.parse(event.watchedAt)))
    .sort((left, right) => Date.parse(left.watchedAt) - Date.parse(right.watchedAt));
  if (!dated.length) return [];

  const orderedEpisodes = [...episodes].sort((left, right) =>
    left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber
  );
  const episodeIndex = new Map(orderedEpisodes.map((episode, index) => [episode.id, index]));
  if (!orderedEpisodes.length || dated.every(event => event.episodeId == null)) {
    return dated.map((event, index) => ({
      id: event.id,
      label: index === 0 ? "Initial watch" : `Rewatch ${index}`,
      startAt: event.watchedAt,
      endAt: event.watchedAt,
      status: "finished",
      complete: true,
      events: [event]
    }));
  }

  const groups: JournalViewingEvent[][] = [];
  let current: JournalViewingEvent[] = [];
  let highestIndex = -1;
  let startIndex = -1;
  let previousTime = Number.NEGATIVE_INFINITY;
  const seenEpisodeIds = new Set<number>();
  const finish = () => {
    if (current.length) groups.push(current);
    current = [];
    highestIndex = -1;
    startIndex = -1;
    previousTime = Number.NEGATIVE_INFINITY;
    seenEpisodeIds.clear();
  };

  for (const event of dated) {
    const index = event.episodeId == null ? undefined : episodeIndex.get(event.episodeId);
    if (index == null) continue;
    const watchedTime = Date.parse(event.watchedAt);
    const previousCompleted = highestIndex >= orderedEpisodes.length - 1;
    const gap = watchedTime - previousTime;
    const repeatedRestart = current.length > 0
      && index <= startIndex
      && gap >= RESTART_GAP_MS
      && (seenEpisodeIds.has(Number(event.episodeId)) || gap >= 30 * 24 * 60 * 60 * 1000);
    if (current.length && (previousCompleted || repeatedRestart)) finish();
    if (!current.length) startIndex = index;
    current.push(event);
    highestIndex = Math.max(highestIndex, index);
    seenEpisodeIds.add(Number(event.episodeId));
    previousTime = watchedTime;
  }
  finish();

  return groups.map((group, index) => {
    const last = group[group.length - 1];
    const complete = last.episodeId != null && episodeIndex.get(last.episodeId) === orderedEpisodes.length - 1;
    const status = complete ? "finished" : index < groups.length - 1 ? "partial" : "ongoing";
    return {
      id: group[0].id,
      label: index === 0 ? "Initial watch" : `Rewatch ${index}`,
      startAt: group[0].watchedAt,
      endAt: status === "ongoing" ? null : last.watchedAt,
      status,
      complete,
      events: group
    };
  });
}
