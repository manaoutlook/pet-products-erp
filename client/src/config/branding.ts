/**
 * Product branding shown on documents the customer keeps: the receipt preview, the print
 * window and the downloaded PDF.
 *
 * AI Agent Note: these strings used to be hard-coded once per output inside
 * client/src/components/POS/ReceiptPrinter.tsx, so the three outputs drifted - the
 * downloaded PDF still printed a different domain from the receipt the cashier saw on
 * screen. Import from here; never re-type the domain in a template literal.
 *
 * This is NOT the company letterhead. The company name, registered address, delivery
 * address and tax ID printed in the header of every document come from the single `company`
 * row via `useCompanyInfo()` / `components/company/CompanyHeader.tsx` - putting them here
 * would be a second source of truth that the database could never correct.
 */
export const BRAND_NAME = 'Smart ERP';

/** Printed as the footer line of every receipt. No scheme - the receipt is on paper. */
export const BRAND_WEBSITE = 'www.smarterp.com';
