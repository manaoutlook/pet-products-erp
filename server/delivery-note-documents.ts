/**
 * Signed delivery note storage.
 *
 * The office photographs or scans the sheet the customer signed and uploads it from the
 * Delivery Notes screen. The browser sends it as a base64 data URL
 * (`data:image/jpeg;base64,....`); this module validates it, writes it to
 * `uploads/delivery-notes/` and returns the short public URL
 * (`/uploads/delivery-notes/<file>`) that `delivery_notes.signed_document_url` stores.
 *
 * AI Agent Note: same trade-off as product pictures (`server/product-images.ts`) - the URL is
 * stored, not the bytes, so the delivery note list stays small. `server/index.ts` serves the
 * directory with `express.static`, so the URL works directly as an `<img src>`.
 *
 * The limit is higher than for product pictures (8 MB vs 5 MB): a phone photo of a signed A4
 * sheet is compressed in the browser (client/src/utils/product-image-upload.ts) but still lands
 * well above a catalogue thumbnail.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Largest decoded image accepted from the client (8 MB). */
export const MAX_SIGNED_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Public URL prefix of the upload directory; also used to recognise stored files. */
export const SIGNED_DOCUMENT_URL_PREFIX = "/uploads/delivery-notes/";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Absolute directory the signed sheets are written to (created on first upload). */
export const signedDocumentsDir = path.resolve(process.cwd(), "uploads", "delivery-notes");

/** An upload the user can fix (wrong format, too large) as opposed to a crash. */
export class DeliveryNoteDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryNoteDocumentError";
  }
}

/** True for URLs this module produced. */
export function isSignedDocumentUrl(value: string): boolean {
  return value.startsWith(SIGNED_DOCUMENT_URL_PREFIX);
}

/**
 * Persist one base64 data URL and return its public URL.
 *
 * Throws `DeliveryNoteDocumentError` when the payload is not a supported image so the route
 * can answer 400 instead of 500.
 */
export async function saveSignedDeliveryNoteDocument(dataUrl: string): Promise<string> {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new DeliveryNoteDocumentError(
      "Invalid picture data. Upload a JPEG, PNG, WebP, GIF or AVIF photo of the signed note."
    );
  }

  const mime = match[1].toLowerCase();
  const extension = EXTENSION_BY_MIME[mime];

  if (!extension) {
    throw new DeliveryNoteDocumentError(
      "Unsupported picture format. Upload a JPEG, PNG, WebP, GIF or AVIF photo of the signed note."
    );
  }

  // Stripping whitespace keeps screenshots-turned-data-URLs working.
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  if (buffer.length === 0) {
    throw new DeliveryNoteDocumentError("The uploaded picture is empty.");
  }

  if (buffer.length > MAX_SIGNED_DOCUMENT_BYTES) {
    throw new DeliveryNoteDocumentError(
      `The picture is too large (${Math.round(buffer.length / 1024 / 1024)} MB). The limit is ${
        MAX_SIGNED_DOCUMENT_BYTES / 1024 / 1024
      } MB.`
    );
  }

  await fs.mkdir(signedDocumentsDir, { recursive: true });

  // Timestamp first so the directory sorts chronologically; the UUID keeps two
  // uploads in the same millisecond apart.
  const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(signedDocumentsDir, fileName), buffer);

  return `${SIGNED_DOCUMENT_URL_PREFIX}${fileName}`;
}
