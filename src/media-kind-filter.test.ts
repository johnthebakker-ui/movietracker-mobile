import { describe, expect, it } from "vitest";
import { filterByMediaKind } from "./media-kind-filter";

const items = [{ kind: "movie", title: "Film" }, { kind: "show", title: "Series" }];

describe("media kind filter", () => {
  it("shows everything by default", () => {
    expect(filterByMediaKind(items, "both", item => item.kind)).toEqual(items);
  });

  it("shows only the selected media kind without mutating the feed", () => {
    expect(filterByMediaKind(items, "movie", item => item.kind)).toEqual([items[0]]);
    expect(filterByMediaKind(items, "show", item => item.kind)).toEqual([items[1]]);
    expect(items).toHaveLength(2);
  });
});
