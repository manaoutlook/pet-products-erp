import { describe, it, expect } from 'vitest';
import { MOBILE_NUMBER_PATTERN, normalizePhoneNumber } from '@shared/phone';

/**
 * The customer rows that predate the profile rework stored the number the way a human writes
 * it (`+84-930-123-456`). The edit form pre-fills `mobileNumber` from the row, so those
 * profiles could not be saved again - the format error was caused by the stored dashes, not by
 * anything the user typed. These assertions pin the canonical form the form and the API now
 * produce.
 */

describe('normalizePhoneNumber', () => {
    it('strips dashes and keeps the leading plus', () => {
        expect(normalizePhoneNumber('+84-930-123-456')).toBe('+84930123456');
    });

    it('strips spaces, dots and brackets', () => {
        expect(normalizePhoneNumber('+84 930 123 456')).toBe('+84930123456');
        expect(normalizePhoneNumber('(028) 3822.1234')).toBe('02838221234');
        expect(normalizePhoneNumber('  0901234567  ')).toBe('0901234567');
    });

    it('drops separators the user leaves behind and keeps the digits', () => {
        expect(normalizePhoneNumber('+84--930')).toBe('+84930');
        expect(normalizePhoneNumber('-090-1')).toBe('0901');
    });

    it('only keeps a plus that is the first character', () => {
        expect(normalizePhoneNumber('84+930')).toBe('84930');
        expect(normalizePhoneNumber('+')).toBe('+');
    });

    it('returns an empty string for empty values, so the form can pre-fill an optional field', () => {
        expect(normalizePhoneNumber('')).toBe('');
        expect(normalizePhoneNumber(null)).toBe('');
        expect(normalizePhoneNumber(undefined)).toBe('');
    });

    it('is idempotent - normalising an already clean number changes nothing', () => {
        const clean = '+84930123456';
        expect(normalizePhoneNumber(clean)).toBe(clean);
        expect(normalizePhoneNumber(normalizePhoneNumber('+84-930-123-456'))).toBe(clean);
    });
});

describe('MOBILE_NUMBER_PATTERN', () => {
    it('accepts international and local numbers once the separators are gone', () => {
        expect(MOBILE_NUMBER_PATTERN.test(normalizePhoneNumber('+84-930-123-456'))).toBe(true);
        expect(MOBILE_NUMBER_PATTERN.test('+84930123456')).toBe(true);
        expect(MOBILE_NUMBER_PATTERN.test('84930123456')).toBe(true);
        // Local form: the per-store customer rows and the POS use the 0-prefixed number.
        expect(MOBILE_NUMBER_PATTERN.test('0901234567')).toBe(true);
        expect(MOBILE_NUMBER_PATTERN.test(normalizePhoneNumber('0901 234 567'))).toBe(true);
    });

    it('still rejects a value that has separators left in it', () => {
        expect(MOBILE_NUMBER_PATTERN.test('+84-930-123-456')).toBe(false);
        expect(MOBILE_NUMBER_PATTERN.test('')).toBe(false);
        expect(MOBILE_NUMBER_PATTERN.test('+')).toBe(false);
        expect(MOBILE_NUMBER_PATTERN.test('12345')).toBe(false);
    });
});
