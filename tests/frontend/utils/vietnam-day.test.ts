import { describe, expect, it } from "vitest";
import {
  VIETNAM_UTC_OFFSET_MINUTES,
  endOfVietnamDay,
  shiftDay,
  startOfVietnamDay,
  vietnamDayOf,
} from "@shared/vietnam-day";

/**
 * The UTC+7 day rule every money figure depends on.
 *
 * Vietnam has no DST, so a payment at 06:30 local is stored as 23:30 UTC the day before. If this
 * conversion is wrong, the finance report, the receipt register and the printed cash book each
 * put the money on a different day - the one defect an accountant will always find.
 */

describe("Vietnam is UTC+7 all year", () => {
  it("offsets by seven hours", () => {
    expect(VIETNAM_UTC_OFFSET_MINUTES).toBe(420);
  });
});

describe("vietnamDayOf", () => {
  it("puts a 23:30 UTC receipt on the next Vietnamese day", () => {
    // 23:30 UTC on the 3rd is 06:30 on the 4th in Ho Chi Minh City.
    expect(vietnamDayOf("2026-11-03T23:30:00.000Z")).toBe("2026-11-04");
    expect(vietnamDayOf("2026-11-03T00:30:00.000Z")).toBe("2026-11-03");
  });

  it("accepts a Date as well as a string", () => {
    expect(vietnamDayOf(new Date("2026-11-03T23:30:00.000Z"))).toBe("2026-11-04");
  });

  it("returns an empty day for an unparseable value instead of Invalid Date", () => {
    expect(vietnamDayOf("not-a-date")).toBe("");
  });
});

describe("Vietnamese day boundaries", () => {
  it("builds the first and last instants at UTC+7, not UTC", () => {
    expect(startOfVietnamDay("2026-11-04").toISOString()).toBe("2026-11-03T17:00:00.000Z");
    expect(endOfVietnamDay("2026-11-04").toISOString()).toBe("2026-11-04T16:59:59.999Z");
  });

  it("covers exactly one day", () => {
    const span = endOfVietnamDay("2026-11-04").getTime() - startOfVietnamDay("2026-11-04").getTime();
    expect(span).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

describe("shiftDay", () => {
  it("walks the calendar without touching a timezone", () => {
    expect(shiftDay("2026-11-04", -29)).toBe("2026-10-06");
    expect(shiftDay("2026-11-04", -59)).toBe("2026-09-06");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("lands on the last day of February in a leap year and a common year", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
  });
});
