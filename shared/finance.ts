/**
 * Financial Accounts rules - the one place they are written down.
 *
 * AI Agent Note - the model, in one paragraph:
 *
 * The shop keeps ONE money book (`finance_entries`) for the entries a person types in, plus a
 * read-only view of the money the receivables module already records. Nothing in this module
 * rewrites a receipt or an invoice: an expense the operator mis-typed is VOIDED (who/when/why),
 * exactly like a payment receipt, so the book always shows what was written and what was
 * corrected.
 *
 *   Receipts / receivables  -> income, a CREDIT  (money comes in)
 *   Manual expenses         -> expense, a DEBIT  (money goes out)
 *   Partner deposit         -> capital/loan, a CREDIT (the partner puts money in)
 *   Partner withdrawal      -> capital/loan, a DEBIT  (the partner takes money back)
 *   Opening balance         -> a CREDIT (money the business already had on day one)
 *
 * The opening balance is deliberately NOT income: it is not money the shop earned this period, so
 * it must not inflate profit. It exists so "money on hand" can start from the truth instead of
 * zero - a till that already held 5,000,000 when the system was adopted would otherwise read
 * 5,000,000 short forever. It is dated on the day the books start, so a period report before that
 * day never sees it.
 *
 * Purchase orders DO post an expense: creating one writes a posted `expense` row under the
 * `PURCHASE_ORDER_EXPENSE_CATEGORY` heading with the PO number as its reference, because the
 * supplier is paid for what the order buys. Cancelling the order voids that entry, so the money
 * book and the purchase register can never drift apart. The report also lists the orders
 * themselves ("Purchases") so the owner can see the supplier and the PO behind the total.
 *
 * Receipts are NOT copied into `finance_entries`: `invoice_payments` is their single source of
 * truth, and the report adds the two streams together. Copying them would mean a voided receipt
 * had to be voided twice, and the two books could drift apart.
 *
 * A partner withdrawal may never exceed what that partner has actually put in. The balance is
 * `sum(deposits) - sum(withdrawals)` over posted entries, so voiding a deposit that has already
 * been withdrawn half of is refused rather than leaving a negative partner balance.
 *
 * `debit` / `credit` are stored on every row, next to the entry type, because the report and the
 * ledger must agree even if a type is ever renamed. `directionOfFinanceEntry` is the single
 * mapping between them.
 */

export const FINANCE_ENTRY_TYPES = [
  'income',
  'expense',
  'partner_deposit',
  'partner_withdrawal',
  'opening_balance',
] as const;
export type FinanceEntryType = (typeof FINANCE_ENTRY_TYPES)[number];

export const FINANCE_DIRECTIONS = ['debit', 'credit'] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_ENTRY_STATUSES = ['posted', 'voided'] as const;
export type FinanceEntryStatus = (typeof FINANCE_ENTRY_STATUSES)[number];

/**
 * The ledger columns the entries screen can be sorted by.
 *
 * The list is shared by the API query schema and the table header so a column the screen can sort
 * on is always a column the server knows how to order, and a bad value is a 400 instead of a
 * silently ignored parameter. `partner` is sorted by the partner's name, not their id.
 */
export const FINANCE_ENTRY_SORT_KEYS = [
  'entryDate',
  'entryNumber',
  'entryType',
  'category',
  'partner',
  'paymentMethod',
  'amount',
  'status',
] as const;
export type FinanceEntrySortKey = (typeof FINANCE_ENTRY_SORT_KEYS)[number];

export const FINANCE_ENTRY_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type FinanceEntrySortDirection = (typeof FINANCE_ENTRY_SORT_DIRECTIONS)[number];

/** A partner's money is either permanent capital or a temporary top-up (a loan). */
export const FUNDING_KINDS = ['capital', 'loan'] as const;
export type FundingKind = (typeof FUNDING_KINDS)[number];

/**
 * The expense heading every purchase order posts under.
 *
 * The order's total is money committed to a supplier, so it is written into the money book as an
 * expense the moment the order is created. Keeping it a fixed heading (instead of free text) is
 * what lets the report group "where the money went" and lets the Purchases list find the entry
 * behind each order again (it is matched by `reference = order_number`).
 */
export const PURCHASE_ORDER_EXPENSE_CATEGORY = 'Supplier purchases';

/**
 * The heading an opening-balance row carries.
 *
 * It is fixed (not offered as a choice) so the report and the cash book can call the figure out by
 * name: money on hand is `everything recorded` minus `the opening balance`, and the owner can see
 * which part of the balance the shop already had before it started using the system.
 */
export const OPENING_BALANCE_CATEGORY = 'Opening balance';

/** Expense headings offered by the entry screen. Free text is not offered, so reports group. */
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries & wages',
  'Transport & delivery',
  'Marketing',
  'Office supplies',
  'Repairs & maintenance',
  'Taxes & fees',
  'Bank charges',
  PURCHASE_ORDER_EXPENSE_CATEGORY,
  'Other expense',
] as const;

/** Income headings for money that did NOT come through an invoice receipt. */
export const INCOME_CATEGORIES = [
  'Other income',
  'Service income',
  'Interest income',
  'Scrap / asset sale',
] as const;

export const FINANCE_ENTRY_TYPE_LABELS: Record<FinanceEntryType, string> = {
  income: 'Income',
  expense: 'Expense',
  partner_deposit: 'Partner deposit',
  partner_withdrawal: 'Partner withdrawal',
  opening_balance: 'Opening balance',
};

export const FINANCE_ENTRY_TYPE_DESCRIPTIONS: Record<FinanceEntryType, string> = {
  income: 'Money received that is not a customer invoice receipt (credit).',
  expense: 'Money paid out by the company (debit).',
  partner_deposit: 'A partner puts capital or a temporary loan into the company (credit).',
  partner_withdrawal: 'A partner takes back money they previously put in (debit).',
  opening_balance:
    'Money the business already had when the books opened (credit). It sets what the till and the bank start from, and is not counted as income or profit.',
};

export const FUNDING_KIND_LABELS: Record<FundingKind, string> = {
  capital: 'Capital',
  loan: 'Temporary loan',
};

export const FINANCE_DIRECTION_LABELS: Record<FinanceDirection, string> = {
  debit: 'Debit',
  credit: 'Credit',
};

export function isFinanceEntryType(value: unknown): value is FinanceEntryType {
  return typeof value === 'string' && (FINANCE_ENTRY_TYPES as readonly string[]).includes(value);
}

export function isFundingKind(value: unknown): value is FundingKind {
  return typeof value === 'string' && (FUNDING_KINDS as readonly string[]).includes(value);
}

/** True for the two entry types that must name a partner. */
export function isPartnerEntryType(type: FinanceEntryType): boolean {
  return type === 'partner_deposit' || type === 'partner_withdrawal';
}

/**
 * The accounting side of an entry.
 *
 * Income, partner deposits and the opening balance bring money in (credit); expenses and partner
 * withdrawals take it out (debit). The stored direction is checked against this function by a
 * database constraint, so a row can never claim an expense is a credit.
 */
export function directionOfFinanceEntry(type: FinanceEntryType): FinanceDirection {
  return type === 'expense' || type === 'partner_withdrawal' ? 'debit' : 'credit';
}

/** Expense headings for an expense, income headings for income; [] for partner and opening rows. */
export function categoriesForFinanceEntry(type: FinanceEntryType): readonly string[] {
  if (type === 'expense') return EXPENSE_CATEGORIES;
  if (type === 'income') return INCOME_CATEGORIES;
  return [];
}

/**
 * The description a purchase order's expense carries.
 *
 * It names the supplier and the PO number so a ledger row can be read on its own - the operator
 * should not have to open the purchase register to know which order the money left for.
 */
export function purchaseOrderExpenseDescription(
  orderNumber: string,
  supplierName: string,
): string {
  const supplier = supplierName.trim() || 'supplier';
  return `Purchase order ${orderNumber} - ${supplier}`;
}

/** Amount with its bookkeeping sign: credits add to cash, debits subtract. */
export function signedFinanceAmount(type: FinanceEntryType, amount: number): number {
  return directionOfFinanceEntry(type) === 'credit' ? amount : -amount;
}

function toNumber(value: string | number | null | undefined): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : 0;
}

/** What a partner still has in the company: deposits minus withdrawals. */
export function partnerBalanceOf(
  deposits: string | number | null | undefined,
  withdrawals: string | number | null | undefined,
): number {
  return Math.round(toNumber(deposits) - toNumber(withdrawals));
}

/**
 * Can this partner take `amount` out?
 *
 * The API calls this under the partner row lock; the screen calls it to disable the button. A
 * withdrawal may not exceed the balance, because that would be taking out money the partner never
 * put in.
 */
export function validatePartnerWithdrawal(
  amount: string | number,
  availableBalance: string | number,
): { valid: boolean; error?: string; suggestion?: string } {
  const requested = toNumber(amount);
  const available = toNumber(availableBalance);

  if (!Number.isFinite(requested) || requested <= 0) {
    return { valid: false, error: 'Enter an amount greater than zero' };
  }
  if (requested > available) {
    return {
      valid: false,
      error: `The partner only has ${available.toLocaleString('vi-VN')} ₫ available to withdraw`,
      suggestion: 'Reduce the amount to the partner balance, or record a deposit first.',
    };
  }
  return { valid: true };
}
