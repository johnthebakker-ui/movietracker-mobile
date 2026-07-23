import { describe, expect, it } from "vitest";

import { notificationIsVisible } from "./visibility";

describe("notification inbox visibility", () => {
  it("keeps a scheduled diagnostic out of the inbox before delivery", () => {
    expect(notificationIsVisible({
      payload: {
        scheduledDiagnostic: true,
        notBefore: "2026-07-23T15:17:00Z"
      }
    }, new Date("2026-07-23T15:16:59Z"))).toBe(false);
  });

  it("shows a scheduled diagnostic once its delivery time is reached", () => {
    expect(notificationIsVisible({
      payload: {
        scheduledDiagnostic: true,
        notBefore: "2026-07-23T15:17:00Z"
      }
    }, new Date("2026-07-23T15:17:00Z"))).toBe(true);
  });

  it("keeps ordinary and immediate-test notifications visible", () => {
    expect(notificationIsVisible({ payload: {} })).toBe(true);
    expect(notificationIsVisible({ payload: { notBefore: "2099-01-01T00:00:00Z" } })).toBe(true);
  });
});
