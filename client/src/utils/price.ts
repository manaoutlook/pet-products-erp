/**
 * Price validation and formatting utilities
 */

// Constants for price validation
export const PRICE_CONSTRAINTS = {
  MIN_PRICE: 0,
  MAX_PRICE: 999999999999, // Increased for VND amounts
  DECIMAL_PLACES: 0, // VND doesn't use decimal places
} as const;

/**
 * Validates a price value
 * @param price - The price to validate
 * @returns An object containing validation result and error message if any
 */
export function validatePrice(price: number | string): { isValid: boolean; error?: string; value?: number } {
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;

  if (isNaN(numericPrice)) {
    return { isValid: false, error: 'Price must be a valid number' };
  }

  if (numericPrice < PRICE_CONSTRAINTS.MIN_PRICE) {
    return { isValid: false, error: 'Price cannot be negative' };
  }

  if (numericPrice > PRICE_CONSTRAINTS.MAX_PRICE) {
    return { isValid: false, error: `Price cannot exceed ${formatPrice(PRICE_CONSTRAINTS.MAX_PRICE)}` };
  }

  return { isValid: true, value: numericPrice };
}

/**
 * Formats a price value with proper currency symbol and grouping
 * @param price - The price to format
 * @param options - Formatting options
 * @returns Formatted price string
 */
export function formatPrice(
  price: number | string,
  options: { 
    currency?: string;
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {}
): string {
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;

  if (isNaN(numericPrice)) {
    return '0 ₫';
  }

  const {
    currency = 'VND',
    locale = 'vi-VN',
    minimumFractionDigits = PRICE_CONSTRAINTS.DECIMAL_PLACES,
    maximumFractionDigits = PRICE_CONSTRAINTS.DECIMAL_PLACES,
  } = options;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(numericPrice);
}

/**
 * Parses a price string into a number
 * @param price - The price string to parse
 * @returns Parsed numeric price value
 */
export function parsePrice(price: string): number {
  // Remove currency symbols and other non-numeric characters except decimal point
  const cleanPrice = price.replace(/[^\d.-]/g, '');
  const numericPrice = parseFloat(cleanPrice);

  return isNaN(numericPrice) ? 0 : numericPrice;
}

/**
 * Normalizes a price value by removing decimal places for VND
 * @param price - The price to normalize
 * @returns Normalized price number
 */
export function normalizePrice(price: number | string): number {
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numericPrice)) return 0;

  // Round to whole numbers since VND doesn't use decimal places
  return Math.round(numericPrice);
}
