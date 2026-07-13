import { describe, expect, it } from "vitest";
import { groupFranchises, listFranchiseName } from "./franchise-groups";
import type { MediaSummary } from "./types";

const item = (title: string, overrides: Partial<MediaSummary> = {}): MediaSummary => ({
  id: Math.random(), kind: "movie", title, overview: "", posterPath: null, backdropPath: null,
  releaseDate: null, endDate: null, status: null, voteAverage: 0, voteCount: 0, popularity: 0,
  genres: [], originalLanguage: "en", originCountries: [], ...overrides
});

describe("mobile franchise grouping contracts", () => {
  it("groups the complete Conjuring universe before narrower TMDB collections", () => {
    const titles = [item("The Conjuring"), item("Annabelle: Creation"), item("The Nun II"), item("The Curse of La Llorona")];
    expect([...groupFranchises(titles).get("The Conjuring Universe") ?? []].map(entry => entry.title)).toEqual(titles.map(entry => entry.title));
  });

  it("keeps manual groups authoritative and retains manual singletons", () => {
    const manual = item("The Conjuring", { franchiseGroup: "My horror order", collectionName: "The Conjuring Collection" });
    expect(listFranchiseName(manual)).toEqual({ name: "My horror order", explicit: true });
    expect(groupFranchises([manual]).get("My horror order")).toEqual([manual]);
  });

  it("uses TMDB collection fallback and moves automatic singletons to Other", () => {
    const fallback = item("Unmatched sequel", { collectionName: "Example Collection" });
    expect(listFranchiseName(fallback)).toEqual({ name: "Example Collection", explicit: false });
    expect(groupFranchises([fallback]).get("Other titles")).toEqual([fallback]);
  });
});
