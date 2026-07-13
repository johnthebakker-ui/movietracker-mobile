import { describe, expect, it } from "vitest";
import { titleYear, userRatingLabel } from "./config";
import type { MediaSummary } from "./types";

describe("poster metadata contracts", () => {
  it("keeps the correct start and end year for ended shows", () => {
    expect(titleYear({ kind: "show", releaseDate: "2017-12-23", endDate: "2018-03-04", status: "Ended" })).toBe("2017-2018 - Ended");
  });

  it("keeps an open run only for returning shows", () => {
    expect(titleYear({ kind: "show", releaseDate: "2023-05-04", endDate: null, status: "Returning Series" })).toBe("2023-");
  });

  it("keeps the user's own poster rating", () => {
    const title: MediaSummary = { id: 1, kind: "movie", title: "Rated", overview: "", posterPath: null, backdropPath: null, releaseDate: null, endDate: null, status: null, voteAverage: 0, voteCount: 0, popularity: 0, genres: [], originalLanguage: "en", originCountries: [], userRating: 8.7 };
    expect(userRatingLabel(title)).toBe("8.7/10");
  });
});
