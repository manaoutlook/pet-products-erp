import { useMemo } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { isHtml } from "@/utils/rich-text";

interface RichTextProps {
  /** Raw value from the API - plain text or an HTML fragment. */
  value: string | null | undefined;
  className?: string;
  /** Rendered when the value is empty/blank. Defaults to nothing. */
  fallback?: React.ReactNode;
}

/**
 * Renders a product description that may be either plain text or HTML.
 *
 * HTML is sanitised with DOMPurify before it is injected, which strips scripts,
 * event handlers and other unsafe markup while keeping the formatting so the
 * product view looks right. Plain text keeps its line breaks and is always
 * rendered as text (never parsed as markup).
 */
export function RichText({ value, className, fallback = null }: RichTextProps) {
  const raw = (value ?? "").trim();
  const html = useMemo(
    () => (isHtml(raw) ? DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }) : ""),
    [raw]
  );

  if (!raw) return <>{fallback}</>;

  if (html) {
    return (
      <div
        className={cn("rich-text", className)}
        // Sanitised above - safe to inject.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Plain text: keep the author's line breaks, but never interpret markup.
  return <div className={cn("rich-text whitespace-pre-line", className)}>{raw}</div>;
}

export default RichText;
