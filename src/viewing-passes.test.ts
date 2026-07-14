import { describe, expect, it } from "vitest";
import { completedRewatchProgress, viewingPassProgress } from "./viewing-passes";

describe("mobile viewing passes", () => {
  const episodes = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, seasonNumber: 1, episodeNumber: index + 1 }));
  const watch = (episodeId: number, day: number) => ({ episodeId, watchedAt: `2026-07-${String(day).padStart(2, "0")}T20:00:00Z` });

  it("keeps an unfinished run at its furthest episode", () => {
    expect(viewingPassProgress(episodes, [watch(1, 1), watch(2, 2), watch(3, 3), watch(2, 4)])).toMatchObject({ nextIndex: 3, completedPasses: 0 });
  });

  it("makes a completed show active again when a rewatch begins", () => {
    const firstRun = episodes.map((episode, index) => watch(episode.id, index + 1));
    expect(viewingPassProgress(episodes, [...firstRun, watch(2, 10)])).toMatchObject({ nextIndex: 2, completedPasses: 1 });
  });

  it("becomes completed again after the rewatch reaches the finale", () => {
    const firstRun = episodes.map((episode, index) => watch(episode.id, index + 1));
    expect(viewingPassProgress(episodes, [...firstRun, watch(2, 10), watch(3, 11), watch(4, 12)])).toMatchObject({ nextIndex: null, completedPasses: 2 });
  });

  it("keeps a rewatch active even when completion metadata was written later", () => {
    const firstRun = episodes.map((episode, index) => watch(episode.id, index + 1));
    expect(completedRewatchProgress(episodes, [...firstRun, watch(1, 10)], "2026-07-14T20:00:00Z", null)).toMatchObject({ active: true, nextIndex: 1, completedPasses: 1 });
  });
});
