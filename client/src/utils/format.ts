/**
 * One place for currency, number, quantity and date formatting.
 *
 * Before this file the app formatted values three different ways:
 * `Number(x).toLocaleString()` (browser locale, no currency), `Intl.NumberFormat('vi-VN', …)`
 * inline in a page, and `formatPrice()` in utils/price.ts - so the same amount could
 * render as "1234567", "1.234.567" or "1.234.567 ₫" depending on the screen, and dates
 * followed whatever locale the browser happened to have.
 *
 * The business is Vietnamese and all amounts are VND, so `vi-VN` is the app-wide default.
 * Every function takes the value it is given (number, numeric string, Date, ISO string)
 * and returns a string - never throws, never renders "Invalid Date" or "NaN".
 */

export const DEFAULT_LOCALE = 'vi-VN';
export const DEFAULT_CURRENCY = 'VND';

/** Shown when a value is missing or unparseable. */
export const EMPTY_PLACEHOLDER = '—';

type Formattable = number | string | null | undefined;

interface NumberFormatOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

function toNumber(value: Formattable): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * VND amount, e.g. `formatCurrency(1234567)` -> "1.234.567 ₫".
 * Rounded to whole units: VND has no minor unit in practice and prices are integers.
 */
export function formatCurrency(
  value: Formattable,
  options: NumberFormatOptions & { currency?: string } = {},
): string {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatCurrency(0, options);
  }

  const {
    locale = DEFAULT_LOCALE,
    currency = DEFAULT_CURRENCY,
    minimumFractionDigits = 0,
    maximumFractionDigits = 0,
  } = options;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(numeric);
}

/**
 * Plain grouped number, e.g. `formatNumber(1234567)` -> "1.234.567".
 * Up to two decimals by default, which covers percentages and averages; use
 * `formatQuantity` for stock.
 */
export function formatNumber(value: Formattable, options: NumberFormatOptions = {}): string {
  const numeric = toNumber(value);
  if (numeric === null) return EMPTY_PLACEHOLDER;

  const {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
  } = options;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(numeric);
}

/**
 * Stock quantity, e.g. `formatQuantity(1500)` -> "1.500".
 * Up to three decimals because some products are sold by weight (kg).
 */
export function formatQuantity(value: Formattable, options: NumberFormatOptions = {}): string {
  return formatNumber(value, { maximumFractionDigits: 3, ...options });
}

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
};

/** Date only, e.g. "08/11/2026". Missing/invalid input renders the placeholder. */
export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions & { locale?: string } = {},
): string {
  const date = toDate(value);
  if (!date) return EMPTY_PLACEHOLDER;

  const { locale = DEFAULT_LOCALE, ...dateOptions } = options;
  return new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS, ...dateOptions }).format(date);
}

/** Date and time, e.g. "08/11/2026 14:30" - replaces bare `toLocaleString()` calls. */
export function formatDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions & { locale?: string } = {},
): string {
  const date = toDate(value);
  if (!date) return EMPTY_PLACEHOLDER;

  const { locale = DEFAULT_LOCALE, ...dateOptions } = options;
  return new Intl.DateTimeFormat(locale, {
    ...DATE_OPTIONS,
    ...TIME_OPTIONS,
    ...dateOptions,
  }).format(date);
}

/** Time only, e.g. "14:30". */
export function formatTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions & { locale?: string } = {},
): string {
  const date = toDate(value);
  if (!date) return EMPTY_PLACEHOLDER;

  const { locale = DEFAULT_LOCALE, ...dateOptions } = options;
  return new Intl.DateTimeFormat(locale, { ...TIME_OPTIONS, ...dateOptions }).format(date);
}

/** Short axis label for charts, e.g. "11 26" (month + 2-digit year). */
export function formatMonthLabel(
  value: DateInput,
  options: Intl.DateTimeFormatOptions & { locale?: string } = {},
): string {
  const date = toDate(value);
  if (!date) return '';

  const { locale = DEFAULT_LOCALE, ...dateOptions } = options;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: '2-digit',
    ...dateOptions,
  }).format(date);
}

/** Percentage from an already-computed ratio, e.g. `formatPercent(0.184)` -> "18,4%". */
export function formatPercent(
  value: Formattable,
  options: NumberFormatOptions = {},
): string {
  const numeric = toNumber(value);
  if (numeric === null) return EMPTY_PLACEHOLDER;

  const {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 0,
    maximumFractionDigits = 1,
  } = options;

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(numeric);
}
