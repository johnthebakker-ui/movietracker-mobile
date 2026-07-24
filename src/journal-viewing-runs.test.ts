import { describe, expect, it } from "vitest";
import { buildJournalViewingRuns } from "./journal-viewing-runs";

const episodes = [
  { id: 1, seasonNumber: 1, episodeNumber: 1 },
  { id: 2, seasonNumber: 1, episodeNumber: 2 },
  { id: 3, seasonNumber: 1, episodeNumber: 3 }
];

const watch = (id: string, episodeId: number, watchedAt: string) => ({
  id, episodeId, watchedAt, seasonId: 10, label: `Episode ${episodeId}`
});

describe("journal viewing runs", () => {
  it("marks an abandoned older pass as partial and the newest pass as ongoing", () => {
    const runs = buildJournalViewingRuns([
      watch("a", 1, "2024-01-01T20:00:00Z"),
      watch("b", 2, "2024-01-02T20:00:00Z"),
      watch("c", 1, "2025-01-01T20:00:00Z")
    ], episodes);
    expect(runs.map(run => run.status)).toEqual(["partial", "ongoing"]);
    expect(runs[0].endAt).toBe("2024-01-02T20:00:00Z");
  });
});
