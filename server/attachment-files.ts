/**
 * Picture storage for transaction proof documents.
 *
 * The browser sends a picture as a base64 data URL (`data:image/png;base64,....`); this module
 * validates it, writes it to `uploads/attachments/` and returns the short public URL
 * (`/uploads/attachments/<file>`) that `attachments.url` stores.
 *
 * AI Agent Note: the bytes live on disk and only the URL is in the database - the same rule
 * `server/product-images.ts` and `server/delivery-note-documents.ts` follow. A receipt photo is
 * hundreds of KB; embedding it would re-send it with every finance/receivables list request.
 * Kept free of database imports so the storage rules can be unit-tested on their own.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ATTACHMENT_URL_PREFIX,
  MAX_ATTACHMENT_BYTES,
  isAttachmentMimeType,
} from "../shared/attachments";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Absolute directory the pictures are written to (created on first upload). */
export const attachmentsDir = path.resolve(process.cwd(), "uploads", "attachments");

/** An upload the user can fix (wrong format, too large) rather than a crash. */
export class AttachmentFileError extends Error {
  /** Lets the route answer 400 without a second mapping table. */
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "AttachmentFileError";
  }
}

/** True for URLs this module produced (so only our own files can be re-linked). */
export function isAttachmentUrl(value: string): boolean {
  return value.startsWith(ATTACHMENT_URL_PREFIX);
}

/**
 * Persist one base64 data URL and return its public URL plus the mime type that was stored.
 *
 * Throws `AttachmentFileError` when the payload is not a supported picture so the route can
 * answer 400 instead of 500.
 */
export async function saveAttachmentImage(
  dataUrl: string
): Promise<{ url: string; mimeType: string }> {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new AttachmentFileError(
      "Invalid picture data. Upload a JPEG, PNG, WebP, GIF or AVIF photo or screenshot."
    );
  }

  const mime = match[1].toLowerCase();

  if (!isAttachmentMimeType(mime)) {
    throw new AttachmentFileError(
      "Unsupported picture format. Upload a JPEG, PNG, WebP, GIF or AVIF photo or screenshot."
    );
  }

  // Stripping whitespace keeps screenshots-turned-data-URLs working.
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  if (buffer.length === 0) {
    throw new AttachmentFileError("The uploaded picture is empty.");
  }

  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentFileError(
      `The picture is too large (${Math.round(buffer.length / 1024 / 1024)} MB). The limit is ${
        MAX_ATTACHMENT_BYTES / 1024 / 1024
      } MB.`
    );
  }

  await fs.mkdir(attachmentsDir, { recursive: true });

  // Timestamp first so the directory sorts chronologically; the UUID keeps two uploads in the
  // same millisecond apart.
  const fileName = `${Date.now()}-${randomUUID()}.${EXTENSION_BY_MIME[mime]}`;
  await fs.writeFile(path.join(attachmentsDir, fileName), buffer);

  return { url: `${ATTACHMENT_URL_PREFIX}${fileName}`, mimeType: mime };
}

/** Remove a stored picture; a missing file is fine (the row is going away anyway). */
export async function deleteAttachmentFile(url: string): Promise<void> {
  if (!isAttachmentUrl(url)) return;
  await fs.rm(path.join(attachmentsDir, path.basename(url)), { force: true });
}
