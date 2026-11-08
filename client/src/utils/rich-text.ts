/**
 * Helpers for product descriptions that may contain either plain text (typed by
 * a user) or HTML (for example copied/imported from a supplier catalogue).
 *
 * The database column stays a plain `text` column - nothing here changes how a
 * description is stored. These helpers only decide how a value is *displayed*:
 * render it as sanitised HTML when it looks like markup, otherwise as plain
 * text so newlines are preserved and angle brackets are never interpreted.
 */

// A value is treated as HTML when it contains something that looks like a tag,
// e.g. `<p ...>`, `<br>`, `<span class="s1">`. Plain sentences that merely
// mention "<" (like "less than 5 < 10") do not match.
const HTML_TAG_PATTERN = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** True when the value appears to be authored as HTML markup. */
export function isHtml(value: string | null | undefined): boolean {
  if (!value) return false;
  return HTML_TAG_PATTERN.test(value);
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Collapses a (possibly HTML) description to a single readable line, suitable
 * for table cells, previews and `title` attributes. Works without a DOM so it
 * can also be used server-side.
 */
export function toPlainText(value: string | null | undefined): string {
  if (!value) return "";

  let text = value;
  if (isHtml(text)) {
    text = text
      // Drop non-visible blocks together with their content first.
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      // Block-level boundaries become spaces so words do not run together.
      .replace(/<\/(p|div|li|tr|h[1-6]|table|section|article)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ");
    // Remove the remaining tags.
    text = text.replace(/<[^>]+>/g, " ");
  }

  return decodeEntities(text)
    .replace(/\s+/g, " ")
    .trim();
}
