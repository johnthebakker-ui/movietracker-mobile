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
    expect(listFranchiseName(manual)).toEqual({ name: "My horror order", explicit: true, source: "manual" });
    expect(groupFranchises([manual]).get("My horror order")).toEqual([manual]);
  });

  it("uses TMDB collection fallback and retains canonical singleton franchises", () => {
    const fallback = item("Unmatched sequel", { collectionName: "Example Collection" });
    expect(listFranchiseName(fallback)).toEqual({ name: "Example Collection", explicit: false, source: "tmdb" });
    expect(groupFranchises([fallback]).get("Example Collection")).toEqual([fallback]);
  });

  it.each([
    ["The Chronicles of Narnia: Prince Caspian", "The Chronicles of Narnia Collection"],
    ["Casino Royale", "James Bond Collection"],
    ["The Hangover", "The Hangover Collection"],
    ["Dumb and Dumber", "Dumb and Dumber Collection"]
  ])("uses canonical collection data rather than a title-specific rule for %s", (title, collectionName) => {
    expect(listFranchiseName(item(title, { collectionName }))).toMatchObject({ name: collectionName, source: "tmdb" });
  });

  it.each([
    ["Toy Story", "Toy Story 3", "Toy Story Collection"],
    ["Kung Fu Panda", "Kung Fu Panda 2", "Kung Fu Panda Collection"],
    ["Monsters, Inc.", "Monsters University", "Monsters, Inc. Collection"],
    ["Zootopia", "Zootopia 2", "Zootopia Collection"],
    ["How to Train Your Dragon", "How to Train Your Dragon 2", "How to Train Your Dragon Collection"],
    ["Finding Nemo", "Finding Dory", "Finding Nemo Collection"],
    ["Cars", "Cars 2", "Cars Collection"]
  ])("recovers well-known animation franchises without replacing manual or TMDB grouping", (first, second, group) => {
    expect([...groupFranchises([item(first), item(second)]).get(group) ?? []].map(entry => entry.title)).toEqual([first, second]);
  });
});
