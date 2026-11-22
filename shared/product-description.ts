/**
 * Helpers for product descriptions.
 *
 * Descriptions imported from a supplier catalogue often arrive with their line
 * breaks *escaped*: the cell holds the two characters `\` + `n` instead of a
 * real newline (and sometimes a real CR). The product details dialog then
 * renders that literally, so a description shows a stray "\n" between its
 * paragraphs and bullets - see `client/src/components/RichText.tsx`.
 *
 * `normalizeDescriptionNewlines` turns those escapes back into real line
 * breaks. It is applied when a description is saved (product create/update and
 * the spreadsheet import) and when it is displayed, so rows written before the
 * rule are cleaned up as well.
 */

/** The escaped sequences a spreadsheet/HTML round-trip leaves behind. */
const ESCAPED_CRLF = /\\r\\n/g; // backslash r + backslash n
const ESCAPED_LF = /\\n/g; // backslash n
const ESCAPED_CR = /\\r/g; // backslash r

/**
 * Converts escaped/legacy line endings into plain `\n` line breaks.
 *
 * - `\r\n`, `\r` and `\n` (backslash escapes) become real newlines
 * - real CRLF and lone CR become real newlines
 * - everything else (including HTML markup) is left untouched
 */
export function normalizeDescriptionNewlines(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(ESCAPED_CRLF, "\n")
    .replace(ESCAPED_LF, "\n")
    .replace(ESCAPED_CR, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export default normalizeDescriptionNewlines;
