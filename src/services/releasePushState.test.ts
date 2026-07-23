import { describe, expect, it } from "vitest";

import { acknowledgedLegacyReleaseKeys } from "./releasePushState";

describe("legacy release notification handoff", () => {
  it("acknowledges presented and already-triggered local releases", () => {
    expect(acknowledgedLegacyReleaseKeys(
      {
        yesterday: "2026-07-22",
        today: "2026-07-23",
        tomorrow: "2026-07-24"
      },
      ["presented"],
      "2026-07-23",
      true
    )).toEqual(expect.arrayContaining(["presented", "yesterday", "today"]));
  });

  it("does not suppress a future or not-yet-triggered release", () => {
    expect(acknowledgedLegacyReleaseKeys(
      { today: "2026-07-23", tomorrow: "2026-07-24" },
      [],
      "2026-07-23",
      false
    )).toEqual([]);
  });
});
