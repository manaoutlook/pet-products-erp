import { describe, it, expect } from 'vitest';
import {
    AGING_BUCKETS,
    agingBucketOf,
    balanceOf,
    canAcceptPayment,
    computeStoredStatus,
    daysPastDue,
    displayInvoiceStatus,
    invoiceStatusLabel,
    paidTotal,
    roundMoney,
    validatePaymentAmount,
} from '@shared/invoice-payment';

/**
 * The receivables rules the API and the browser share.
 *
 * Both sides import this module, so these are the decisions that must not drift: what "overdue"
 * means, which aging bucket a day falls in, how much of an invoice is still owed, and whether a
 * receipt is allowed. Everything is a pure function of its arguments and an explicit `today`.
 */

const TODAY = new Date('2026-11-20T05:00:00.000Z');

describe('amounts', () => {
    it('rounds to whole dong and treats junk as zero', () => {
        expect(roundMoney(1000.4)).toBe(1000);
        expect(roundMoney(1000.5)).toBe(1001);
        expect(roundMoney(Number.NaN)).toBe(0);
        expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('never reports a negative balance', () => {
        expect(balanceOf(1000, 400)).toBe(600);
        // Overpaid: the document value does not change, the balance simply stops at zero.
        expect(balanceOf(1000, 1500)).toBe(0);
        expect(balanceOf('1000.00', '1000.00')).toBe(0);
        // Unparseable stored values are treated as zero rather than NaN.
        expect(balanceOf('abc', '0')).toBe(0);
    });
});

describe('computeStoredStatus', () => {
    it('keeps a cancelled document cancelled whatever was paid', () => {
        expect(computeStoredStatus({ cancelled: true, totalAmount: 1000, amountPaid: 1000 })).toBe('cancelled');
    });

    it('derives issued / partially paid / paid from the money received', () => {
        expect(computeStoredStatus({ cancelled: false, totalAmount: 1000, amountPaid: 0 })).toBe('issued');
        expect(computeStoredStatus({ cancelled: false, totalAmount: 1000, amountPaid: 400 })).toBe('partially_paid');
        expect(computeStoredStatus({ cancelled: false, totalAmount: 1000, amountPaid: 1000 })).toBe('paid');
        // Overpayment still counts as paid.
        expect(computeStoredStatus({ cancelled: false, totalAmount: 1000, amountPaid: 1200 })).toBe('paid');
    });
});

describe('dates and aging', () => {
    it('counts whole calendar days past the due date', () => {
        expect(daysPastDue('2026-11-10', TODAY)).toBe(10);
        expect(daysPastDue('2026-11-20', TODAY)).toBe(0);
        expect(daysPastDue('2026-11-25', TODAY)).toBe(-5);
        expect(daysPastDue(new Date('2026-11-01T23:00:00.000Z'), TODAY)).toBe(19);
    });

    it('treats a missing or invalid due date as not due', () => {
        expect(daysPastDue(null, TODAY)).toBe(0);
        expect(daysPastDue(undefined, TODAY)).toBe(0);
        expect(daysPastDue('not a date', TODAY)).toBe(0);
    });

    it('buckets the days past due, from "not due yet" to the last bucket', () => {
        expect(agingBucketOf('2026-11-25', TODAY).key).toBe(AGING_BUCKETS[0].key);
        expect(agingBucketOf('2026-11-19', TODAY).key).toBe('1_30');
        expect(agingBucketOf('2026-10-01', TODAY).key).toBe('31_60');
        // Far in the past lands in the final bucket rather than returning undefined.
        expect(agingBucketOf('2020-01-01', TODAY).key).toBe(AGING_BUCKETS[AGING_BUCKETS.length - 1].key);
    });

    it('reports overdue only while money is still owed', () => {
        const base = { status: 'issued', balanceDue: 1000, dueDate: '2026-11-01' };

        expect(displayInvoiceStatus(base, TODAY)).toBe('overdue');
        expect(displayInvoiceStatus({ ...base, balanceDue: 0 }, TODAY)).toBe('issued');
        expect(displayInvoiceStatus({ ...base, status: 'partially_paid', dueDate: '2026-12-01' }, TODAY)).toBe(
            'partially_paid',
        );
        // An unrecognised stored status is shown as issued, never as a blank badge.
        expect(displayInvoiceStatus({ ...base, status: 'weird', dueDate: '2026-12-01' }, TODAY)).toBe('issued');
    });

    it('labels every status, passing unknown ones through', () => {
        expect(invoiceStatusLabel('issued')).toBe('Issued / unpaid');
        expect(invoiceStatusLabel('partially_paid')).toBe('Partially paid');
        expect(invoiceStatusLabel('paid')).toBe('Paid');
        expect(invoiceStatusLabel('overdue')).toBe('Overdue');
        expect(invoiceStatusLabel('cancelled')).toBe('Cancelled');
        expect(invoiceStatusLabel('draft')).toBe('draft');
    });
});

describe('validatePaymentAmount', () => {
    it('asks for an amount when the field is empty', () => {
        expect(validatePaymentAmount('', 1000)).toMatchObject({ valid: false, amount: 0 });
        expect(validatePaymentAmount('   ', 1000)).toMatchObject({ valid: false });
        expect(validatePaymentAmount(null, 1000).error).toBe('Enter the amount received');
        expect(validatePaymentAmount(undefined, 1000).valid).toBe(false);
    });

    it('refuses a non-positive amount', () => {
        expect(validatePaymentAmount('abc', 1000).error).toBe(
            'The amount received must be greater than zero',
        );
        expect(validatePaymentAmount(0, 1000).valid).toBe(false);
        expect(validatePaymentAmount(-5, 1000).valid).toBe(false);
    });

    it('refuses an amount too small to be whole dong', () => {
        expect(validatePaymentAmount(0.4, 1000)).toMatchObject({
            valid: false,
            amount: 0,
            error: 'The amount received is too small to record',
        });
    });

    it('refuses money against an invoice that is already paid', () => {
        expect(validatePaymentAmount(100, 0)).toMatchObject({
            valid: false,
            error: 'This invoice is already paid in full',
        });
    });

    it('refuses an overpayment instead of clipping it', () => {
        const result = validatePaymentAmount(1500, 1000);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('The amount exceeds the balance of 1000');
        expect(result.suggestion).toMatch(/outstanding balance/);
    });

    it('accepts an amount inside the balance, commas and all', () => {
        expect(validatePaymentAmount('1,000', 1500)).toEqual({ valid: true, amount: 1000 });
        expect(validatePaymentAmount(1500, 1500)).toEqual({ valid: true, amount: 1500 });
    });
});

describe('canAcceptPayment / paidTotal', () => {
    it('refuses a cancelled invoice', () => {
        expect(
            canAcceptPayment({ status: 'cancelled', totalAmount: 1000, amountPaid: 0, balanceDue: 1000 }),
        ).toEqual({ allowed: false, reason: 'This invoice is cancelled and cannot take payments' });
    });

    it('refuses an invoice that is already settled', () => {
        expect(
            canAcceptPayment({ status: 'paid', totalAmount: 1000, amountPaid: 1000, balanceDue: 0 }),
        ).toEqual({ allowed: false, reason: 'This invoice is already paid in full' });
    });

    it('allows a payment while money is still owed', () => {
        expect(
            canAcceptPayment({ status: 'issued', totalAmount: 1000, amountPaid: 250, balanceDue: 750 }),
        ).toEqual({ allowed: true });
    });

    it('adds up only the receipts that still count', () => {
        const total = paidTotal([
            { amount: '400.00' },
            { amount: 100 },
            // A voided receipt is kept in the book but no longer counts.
            { amount: '999.00', voidedAt: '2026-11-01T00:00:00.000Z' },
        ]);

        expect(total).toBe(500);
        expect(paidTotal([])).toBe(0);
    });
});

