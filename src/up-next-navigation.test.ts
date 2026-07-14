import { describe, expect, it } from "vitest";
import { episodeTargetForUpNext, type UpNextEntry } from "./up-next-navigation";
import type { MediaSummary } from "./types";

const media = (kind: "movie" | "show"): MediaSummary => ({
  id: kind === "show" ? 1396 : 162,
  kind,
  title: kind === "show" ? "Breaking Bad" : "Edward Scissorhands",
  overview: "",
  posterPath: "/poster.jpg",
  backdropPath: "/backdrop.jpg",
  releaseDate: "2008-01-20",
  voteAverage: 8,
  voteCount: 1,
  popularity: 1,
  genres: []
});

describe("Up Next navigation", () => {
  it("preserves the exact episode target for series entries", () => {
    const entry: UpNextEntry = { item: media("show"), label: "S2 E3", reason: "Next unwatched episode", seasonNumber: 2, episodeNumber: 3, episodeTitle: "Bit by a Dead Bee", runtime: 47 };
    expect(episodeTargetForUpNext(entry)).toMatchObject({ seasonNumber: 2, episodeNumber: 3, title: "Bit by a Dead Bee", runtime: 47 });
  });

  it("keeps movie entries on normal title navigation", () => {
    const entry: UpNextEntry = { item: media("movie"), label: "Continue movie", reason: "Started but not finished" };
    expect(episodeTargetForUpNext(entry)).toBeNull();
  });
});
