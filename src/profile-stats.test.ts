import { describe, expect, it } from "vitest";

import { compactProfileStatValue } from "./profile-stats";

describe("compactProfileStatValue", () => {
  it("keeps normal counts and ratings unchanged", () => {
    expect(compactProfileStatValue(999)).toBe("999");
    expect(compactProfileStatValue(8.5)).toBe("8.5");
    expect(compactProfileStatValue("-")).toBe("-");
  });

  it("caps oversized profile counts without exposing their full width", () => {
    expect(compactProfileStatValue(1_000)).toBe("999+");
    expect(compactProfileStatValue(12_309_182_389_123)).toBe("999+");
  });
});
