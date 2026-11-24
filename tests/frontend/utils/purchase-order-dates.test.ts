import { describe, expect, it } from "vitest";
import {
  BACK_DATED_PURCHASE_ORDER_MESSAGE,
  isBackDatedPurchaseOrderDate,
  todayInVietnam,
} from "@shared/purchase-order-dates";

/**
 * Which expected delivery dates count as back-dated.
 *
 * The rule gates an administrator-only feature, and it is shared by the create-order dialog and
 * the API, so it is pinned here: the boundary is the Vietnamese calendar day (the same day the
 * finance screens use), not the server's or the browser's timezone - otherwise a 07:00 order
 * entered on a UTC server would be judged against yesterday.
 */

describe("isBackDatedPurchaseOrderDate", () => {
  // 03:00 UTC on the 10th is 10:00 on the 10th in Vietnam.
  const now = new Date("2026-11-10T03:00:00.000Z");

  it("accepts today", () => {
    expect(isBackDatedPurchaseOrderDate("2026-11-10T08:00", now)).toBe(false);
  });

  it("accepts a future date", () => {
    expect(isBackDatedPurchaseOrderDate("2026-11-25T10:00", now)).toBe(false);
  });

  it("rejects yesterday", () => {
    expect(isBackDatedPurchaseOrderDate("2026-11-09T23:00", now)).toBe(true);
  });

  it("uses the Vietnamese day, not the UTC day", () => {
    // 18:00 UTC on the 9th is 01:00 on the 10th in Vietnam, so it is "today" - not back-dated.
    expect(isBackDatedPurchaseOrderDate("2026-11-09T18:00:00.000Z", now)).toBe(false);
    // 16:00 UTC on the 9th is 23:00 on the 9th in Vietnam, so it is yesterday.
    expect(isBackDatedPurchaseOrderDate("2026-11-09T16:00:00.000Z", now)).toBe(true);
  });

  it("does not call an unparsable date back-dated", () => {
    // The shape is the schema's job; this rule must not answer for it.
    expect(isBackDatedPurchaseOrderDate("not-a-date", now)).toBe(false);
  });

  it("names the refusal once, for the dialog and the API", () => {
    expect(BACK_DATED_PURCHASE_ORDER_MESSAGE).toMatch(/administrator/i);
  });
});

describe("todayInVietnam", () => {
  it("returns the Vietnamese day of the given instant", () => {
    expect(todayInVietnam(new Date("2026-11-09T18:00:00.000Z"))).toBe("2026-11-10");
  });
});
