/**
 * Receivable (accounts-receivable) rules - the one place they are written down.
 *
 * AI Agent Note - the model, in one paragraph:
 *
 * A sale or a sales order produces exactly ONE invoice for its full value (`invoices`). The
 * customer may settle it with any number of payment receipts (`invoice_payments`), each with
 * its own `RCPT-YYYYMMDD-NNNN` number. The invoice therefore carries two independent numbers:
 * its own (immutable) value and how much of that value has been received:
 *
 *     total_amount  = what the document says the customer owes   (never changes)
 *     amount_paid   = sum of the receipts that have not been voided
 *     balance_due   = total_amount - amount_paid
 *
 * Status follows from those numbers, never the other way round:
 *
 *     paid            balance_due <= 0
 *     partially_paid  0 < amount_paid < total_amount
 *     issued          amount_paid = 0
 *     cancelled       the document itself was voided (no further payments accepted)
 *
 * `overdue` is NOT stored: a row cannot become overdue without somebody touching it, so it is
 * derived at read time from `due_date`. `overdue` is therefore a *display* status of an
 * `issued`/`partially_paid` invoice whose due date has passed.
 *
 * This module is shared so the API and the browser can never disagree about what "overdue"
 * means or whether a payment fits in the remaining balance.
 */

export const INVOICE_KINDS = ['VAT', 'RETAIL'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_SOURCES = ['POS_SALE', 'SALES_ORDER'] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

/** Statuses that are actually persisted on `invoices.status`. */
export const STORED_INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'cancelled'] as const;
export type StoredInvoiceStatus = (typeof STORED_INVOICE_STATUSES)[number];

/** Statuses the API/UI may return - the stored ones plus the derived `overdue`. */
export const INVOICE_STATUSES = [...STORED_INVOICE_STATUSES, 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Payment methods offered when a receipt is recorded. Stored upper-case. */
export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'DIGITAL_WALLET',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * How each stored method is written on screen and on paper.
 *
 * Shared so the Finance report's money-on-hand split names a method the same way the receipt
 * screens do; a method nobody listed falls back to its stored value.
 */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  DIGITAL_WALLET: 'Digital wallet',
  OTHER: 'Other',
};

export interface AgingBucket {
  key: 'current' | '1_30' | '31_60' | '61_90' | 'over_90';
  label: string;
  /** Inclusive lower bound of days past due; `null` for the not-yet-due bucket. */
  minDays: number | null;
  maxDays: number | null;
}

export const AGING_BUCKETS: AgingBucket[] = [
  { key: 'current', label: 'Not yet due', minDays: null, maxDays: null },
  { key: '1_30', label: '1-30 days', minDays: 1, maxDays: 30 },
  { key: '31_60', label: '31-60 days', minDays: 31, maxDays: 60 },
  { key: '61_90', label: '61-90 days', minDays: 61, maxDays: 90 },
  { key: 'over_90', label: 'Over 90 days', minDays: 91, maxDays: null },
];

/** Days a document may stay unpaid before it is shown as overdue. */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;

export function roundMoney(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function toNumber(value: string | number | null | undefined): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : 0;
}

/** `total - paid`, never negative. The invoice value is fixed; only this shrinks. */
export function balanceOf(totalAmount: string | number, amountPaid: string | number): number {
  const balance = roundMoney(toNumber(totalAmount) - toNumber(amountPaid));
  return balance > 0 ? balance : 0;
}

/**
 * The status a payment run should store.
 *
 * `cancelled` wins over everything: a cancelled document stays cancelled even though its
 * payments (which must be refunded separately) may not add up to its value.
 */
export function computeStoredStatus(input: {
  cancelled: boolean;
  totalAmount: string | number;
  amountPaid: string | number;
}): StoredInvoiceStatus {
  if (input.cancelled) return 'cancelled';
  const total = roundMoney(toNumber(input.totalAmount));
  const paid = roundMoney(toNumber(input.amountPaid));
  if (paid <= 0) return 'issued';
  if (paid >= total) return 'paid';
  return 'partially_paid';
}

/** Calendar-day difference between a due date and `today`, ignoring the time of day. */
export function daysPastDue(
  dueDate: string | Date | null | undefined,
  today: Date = new Date()
): number {
  if (!dueDate) return 0;
  const due = typeof dueDate === 'string' ? new Date(`${dueDate.slice(0, 10)}T00:00:00Z`) : dueDate;
  if (Number.isNaN(due.getTime())) return 0;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.floor((todayUtc - dueUtc) / 86_400_000);
}

/**
 * An invoice is overdue when it still owes money and its due date is in the past.
 * A paid or cancelled invoice is never overdue, however old it is.
 */
export function isInvoiceOverdue(
  invoice: {
    status: string;
    balanceDue: string | number;
    dueDate: string | Date | null | undefined;
  },
  today: Date = new Date()
): boolean {
  if (invoice.status === 'paid' || invoice.status === 'cancelled') return false;
  if (toNumber(invoice.balanceDue) <= 0) return false;
  if (!invoice.dueDate) return false;
  return daysPastDue(invoice.dueDate, today) > 0;
}

/** The status shown to a human: the stored one, or `overdue` when the due date has passed. */
export function displayInvoiceStatus(
  invoice: {
    status: string;
    balanceDue: string | number;
    dueDate: string | Date | null | undefined;
  },
  today: Date = new Date()
): InvoiceStatus {
  if (isInvoiceOverdue(invoice, today)) return 'overdue';
  return (STORED_INVOICE_STATUSES as readonly string[]).includes(invoice.status)
    ? (invoice.status as StoredInvoiceStatus)
    : 'issued';
}

/** Human label for a status (badges, report headers, printed receipts). */
export function invoiceStatusLabel(status: string): string {
  switch (status) {
    case 'issued':
      return 'Issued / unpaid';
    case 'partially_paid':
      return 'Partially paid';
    case 'paid':
      return 'Paid';
    case 'overdue':
      return 'Overdue';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

export function agingBucketOf(
  dueDate: string | Date | null | undefined,
  today: Date = new Date()
): AgingBucket {
  const days = daysPastDue(dueDate, today);
  if (days <= 0) return AGING_BUCKETS[0];
  return (
    AGING_BUCKETS.find(
      (bucket) =>
        bucket.minDays !== null &&
        days >= bucket.minDays &&
        (bucket.maxDays === null || days <= bucket.maxDays)
    ) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]
  );
}

export interface PaymentValidation {
  valid: boolean;
  /** Rounded amount to store, only meaningful when `valid` is true. */
  amount: number;
  error?: string;
  suggestion?: string;
}

/**
 * Validate one instalment against what is still owed.
 *
 * Rules: a receipt must be a positive whole number of dong and may not exceed the balance.
 * Overpayment is refused rather than silently clipped - the operator has to decide whether the
 * customer is paying a different invoice or wants a credit.
 */
export function validatePaymentAmount(
  rawAmount: string | number | null | undefined,
  balanceDue: string | number
): PaymentValidation {
  const balance = roundMoney(toNumber(balanceDue));
  if (rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === '') {
    return {
      valid: false,
      amount: 0,
      error: 'Enter the amount received',
      suggestion: 'The amount must be greater than zero',
    };
  }

  const parsed = typeof rawAmount === 'string' ? Number(rawAmount.replace(/,/g, '')) : rawAmount;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      valid: false,
      amount: 0,
      error: 'The amount received must be greater than zero',
      suggestion: 'Enter the money the customer actually handed over',
    };
  }

  const amount = roundMoney(parsed);
  if (amount <= 0) {
    return {
      valid: false,
      amount: 0,
      error: 'The amount received is too small to record',
      suggestion: 'VND amounts are whole dong',
    };
  }

  if (balance <= 0) {
    return {
      valid: false,
      amount,
      error: 'This invoice is already paid in full',
      suggestion: 'Open the invoice to see its payment receipts',
    };
  }

  if (amount > balance) {
    return {
      valid: false,
      amount,
      error: `The amount exceeds the balance of ${balance}`,
      suggestion: 'Record at most the outstanding balance, or correct the amount',
    };
  }

  return { valid: true, amount };
}

/** Whether another receipt can be recorded against this invoice. */
export function canAcceptPayment(invoice: {
  status: string;
  totalAmount: string | number;
  amountPaid: string | number;
  balanceDue: string | number;
}): { allowed: boolean; reason?: string } {
  if (invoice.status === 'cancelled') {
    return { allowed: false, reason: 'This invoice is cancelled and cannot take payments' };
  }
  if (balanceOf(invoice.totalAmount, invoice.amountPaid) <= 0) {
    return { allowed: false, reason: 'This invoice is already paid in full' };
  }
  return { allowed: true };
}

/** Sum of the receipts that still count (voided ones are kept, but not counted). */
export function paidTotal(
  payments: Array<{ amount: string | number; voidedAt?: string | Date | null }>
): number {
  return roundMoney(
    payments.reduce(
      (sum, payment) => (payment.voidedAt ? sum : sum + toNumber(payment.amount)),
      0
    )
  );
}
