import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateDeliveryNoteNumber,
  generateOrderNumber,
  generateReceiptNumber,
  generateSalesOrderNumber,
  generateTransferNumber,
} from '../../server/numbering';
import { vietnamDateOffset } from '../../server/invoices';

/**
 * Every day printed on a document is the Vietnamese day.
 *
 * A document raised at 06:30 in Ho Chi Minh City is 23:30 UTC the day before. Stamping the
 * number or the due date from the UTC day prints yesterday's date on today's paper, and it is
 * the kind of error an auditor finds before the shop does. These tests all run at 06:30 local,
 * the hour where the two calendars disagree.
 */

/** 06:30 on 4 April 2026 in Ho Chi Minh City = 23:30 on 3 April UTC. */
const JUST_AFTER_LOCAL_MIDNIGHT = new Date('2026-04-03T23:30:00.000Z');

function clockAt(instant: Date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('document numbers carry the Vietnamese day', () => {
  it('stamps purchase orders, GRNs, sales orders and delivery notes with the local day', () => {
    clockAt(JUST_AFTER_LOCAL_MIDNIGHT);

    expect(generateOrderNumber()).toMatch(/^PO-20260404-\d{4}$/);
    expect(generateReceiptNumber()).toMatch(/^GRN-20260404-\d{4}$/);
    expect(generateSalesOrderNumber()).toMatch(/^SO-20260404-\d{4}$/);
    expect(generateDeliveryNoteNumber()).toMatch(/^DN-20260404-\d{4}$/);
  });

  it('does not roll the day back at the UTC boundary', () => {
    clockAt(new Date('2026-04-04T16:59:00.000Z')); // 23:59 on 4 April local
    expect(generateOrderNumber()).toMatch(/^PO-20260404-/);

    clockAt(new Date('2026-04-04T17:00:00.000Z')); // 00:00 on 5 April local
    expect(generateOrderNumber()).toMatch(/^PO-20260405-/);
  });
});

describe('transfer numbers', () => {
  it('use the Vietnamese day and the local time of day', () => {
    clockAt(JUST_AFTER_LOCAL_MIDNIGHT);

    expect(generateTransferNumber('TRF')).toBe('TRF-20260404-063000000');
    expect(generateTransferNumber('QTRF')).toBe('QTRF-20260404-063000000');
  });

  it('differ for two transfers raised in different milliseconds, because the column is UNIQUE', () => {
    // The old suffix was four random digits: 9,000 buckets, so ~50 transfers a day collided
    // about once a week - and the insert failed with a constraint error the user could not fix.
    clockAt(JUST_AFTER_LOCAL_MIDNIGHT);
    const first = generateTransferNumber('TRF');

    vi.setSystemTime(new Date(JUST_AFTER_LOCAL_MIDNIGHT.getTime() + 1));
    const second = generateTransferNumber('TRF');

    expect(first).not.toBe(second);
    expect(second).toBe('TRF-20260404-063000001');
  });

  it('sort in the order they were raised', () => {
    clockAt(JUST_AFTER_LOCAL_MIDNIGHT);
    const morning = generateTransferNumber('TRF');

    clockAt(new Date('2026-04-04T03:00:00.000Z')); // 10:00 local, same day
    const later = generateTransferNumber('TRF');

    expect(later > morning).toBe(true);
  });
});

describe('vietnamDateOffset', () => {
  it('counts payment terms in Vietnamese days', () => {
    // Issued 06:30 on 4 April local; 30 days of credit is due 4 May, not 3 May.
    expect(vietnamDateOffset(JUST_AFTER_LOCAL_MIDNIGHT, 30)).toBe('2026-05-04');
  });

  it('keeps a same-day document on the issue day', () => {
    expect(vietnamDateOffset(JUST_AFTER_LOCAL_MIDNIGHT, 0)).toBe('2026-04-04');
  });

  it('crosses month and year ends', () => {
    const newYearsEve = new Date('2026-12-31T20:00:00.000Z'); // 03:00 on 1 January 2027 local
    expect(vietnamDateOffset(newYearsEve, 0)).toBe('2027-01-01');
    expect(vietnamDateOffset(newYearsEve, -1)).toBe('2026-12-31');
  });
});
