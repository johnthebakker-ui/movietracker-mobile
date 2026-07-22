import { describe, expect, it } from "vitest";

import { formatWatchDateInput, formatWatchTimeInput, isValidWatchDate, isValidWatchDateTime, isValidWatchTime, nextWatchTimeInput } from "./watch-log-input";

describe("watch log date and time input", () => {
  it("keeps only date digits and inserts separators", () => {
    expect(formatWatchDateInput("2026abc0722")).toBe("2026-07-22");
  });

  it("keeps only time digits and inserts the colon", () => {
    expect(formatWatchTimeInput("22:05hh")).toBe("22:05");
    expect(nextWatchTimeInput("22:05", "24:05")).toBe("22:05");
    expect(nextWatchTimeInput("22:05", "22:60")).toBe("22:05");
  });

  it("accepts only real dates", () => {
    expect(isValidWatchDate("2024-02-29")).toBe(true);
    expect(isValidWatchDate("2026-02-29")).toBe(false);
    expect(isValidWatchDate("2026-13-01")).toBe(false);
  });

  it("accepts times from 00:00 through 23:59", () => {
    expect(isValidWatchTime("00:00")).toBe(true);
    expect(isValidWatchTime("23:59")).toBe(true);
    expect(isValidWatchTime("24:00")).toBe(false);
    expect(isValidWatchTime("22:60")).toBe(false);
    expect(isValidWatchTime("22:05hh")).toBe(false);
  });

  it("requires both fields to be complete", () => {
    expect(isValidWatchDateTime("2026-07-22", "22:05")).toBe(true);
    expect(isValidWatchDateTime("2026-07", "22:05")).toBe(false);
  });
});
