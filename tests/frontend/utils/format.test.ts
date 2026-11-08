import { describe, it, expect } from 'vitest';
import {
    EMPTY_PLACEHOLDER,
    formatCurrency,
    formatDate,
    formatDateTime,
    formatMonthLabel,
    formatNumber,
    formatPercent,
    formatQuantity,
    formatTime,
} from '@/utils/format';
import { formatPrice } from '@/utils/price';

/**
 * These helpers replaced three competing implementations: `Number(x).toLocaleString()`
 * (browser locale), inline `Intl.NumberFormat('vi-VN', …)` calls in pages, and
 * `formatDate` in lib/utils (date-fns "MMM dd, yyyy"). The assertions pin the VND /
 * vi-VN defaults those screens now share.
 */

/** Intl separates the amount from the symbol with a non-breaking space. */
const plain = (value: string) => value.replace(/\u00a0/g, ' ');
describe('formatNumber / formatQuantity', () => {
    it('groups thousands the Vietnamese way', () => {
        expect(formatNumber(1234567)).toBe('1.234.567');
        expect(formatNumber(0)).toBe('0');
    });

    it('keeps at most two decimals for numbers and three for stock quantities', () => {
        expect(formatNumber(1234.567)).toBe('1.234,57');
        expect(formatQuantity(1500)).toBe('1.500');
        expect(formatQuantity(2.5)).toBe('2,5');
        expect(formatQuantity(0.125)).toBe('0,125');
    });

    it('renders a placeholder instead of NaN or "Invalid Date"', () => {
        expect(formatNumber(null)).toBe(EMPTY_PLACEHOLDER);
        expect(formatNumber(undefined)).toBe(EMPTY_PLACEHOLDER);
        expect(formatNumber('not a number')).toBe(EMPTY_PLACEHOLDER);
        expect(formatQuantity('')).toBe(EMPTY_PLACEHOLDER);
    });

    it('accepts numeric strings, because API payloads and form inputs send those', () => {
        expect(formatNumber('1234.5')).toBe('1.234,5');
    });
});

describe('formatCurrency', () => {
    it('formats VND with no minor unit', () => {
        expect(plain(formatCurrency(1234567))).toBe('1.234.567 ₫');
        expect(plain(formatCurrency(1234.6))).toBe('1.235 ₫');
        expect(plain(formatCurrency('2500'))).toBe('2.500 ₫');
    });

    it('falls back to zero for unusable input rather than showing NaN', () => {
        expect(plain(formatCurrency(null))).toBe('0 ₫');
        expect(plain(formatCurrency(undefined))).toBe('0 ₫');
        expect(plain(formatCurrency('abc'))).toBe('0 ₫');
    });

    it('still honours explicit locale/currency options', () => {
        expect(formatCurrency(1234.56, { locale: 'en-US', currency: 'USD', maximumFractionDigits: 2 }))
            .toBe('$1,234.56');
    });

    it('is the single currency implementation, so formatPrice agrees with it', () => {
        expect(formatPrice(1234567)).toBe(formatCurrency(1234567));
        expect(plain(formatPrice('abc'))).toBe('0 ₫');
    });
});

describe('formatDate / formatDateTime / formatTime', () => {
    // Local-time input so the assertion does not depend on the machine's timezone.
    const timestamp = '2026-11-08T14:30:00';

    it('renders dd/mm/yyyy for both Date objects and ISO strings', () => {
        expect(formatDate(timestamp)).toBe('08/11/2026');
        expect(formatDate(new Date(timestamp))).toBe('08/11/2026');
    });

    it('adds the time in HH:mm when asked', () => {
        expect(formatDateTime(timestamp)).toBe('14:30 08/11/2026');
        expect(formatTime(timestamp)).toBe('14:30');
    });

    it('renders the placeholder for missing or unparseable dates', () => {
        expect(formatDate(null)).toBe(EMPTY_PLACEHOLDER);
        expect(formatDate(undefined)).toBe(EMPTY_PLACEHOLDER);
        expect(formatDateTime('not a date')).toBe(EMPTY_PLACEHOLDER);
        expect(formatTime('')).toBe(EMPTY_PLACEHOLDER);
    });

    it('supports the month/year label used on chart axes', () => {
        expect(formatMonthLabel(timestamp)).toBe('thg 11 26');
        expect(formatMonthLabel(null)).toBe('');
    });

    it('accepts overrides for the longer tooltip label', () => {
        expect(formatDate(timestamp, { month: 'long', year: 'numeric' })).toContain('2026');
    });
});

describe('formatPercent', () => {
    it('formats an already-computed ratio', () => {
        expect(formatPercent(0.184)).toBe('18,4%');
        expect(formatPercent(1)).toBe('100%');
        expect(formatPercent(null)).toBe(EMPTY_PLACEHOLDER);
    });
});
