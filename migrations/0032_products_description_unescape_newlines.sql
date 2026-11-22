-- Product descriptions imported from a supplier catalogue stored *escaped* line
-- breaks: the text holds the two characters "\" + "n" (often after a real CR)
-- instead of a real newline. The product details dialog rendered them verbatim,
-- so "…everyday use.</p>\r\n\r\n<ul>…" showed a stray "\n" between the
-- paragraphs and the bullets.
--
-- Replace the escapes with real newlines: HTML collapses the extra whitespace,
-- and plain-text descriptions keep their line breaks (RichText renders plain
-- text with `whitespace-pre-line`). The same normalisation is applied when a
-- description is saved - see shared/product-description.ts.
UPDATE products
SET description = replace(
      replace(
        replace(
          replace(
            description,
            chr(92) || 'r' || chr(92) || 'n',
            chr(10)
          ),
          chr(92) || 'n',
          chr(10)
        ),
        chr(92) || 'r',
        chr(10)
      ),
      chr(13),
      chr(10)
    ),
    updated_at = NOW()
WHERE strpos(description, chr(92) || 'n') > 0
   OR strpos(description, chr(92) || 'r') > 0
   OR strpos(description, chr(13)) > 0;
