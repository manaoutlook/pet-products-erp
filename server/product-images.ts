/**
 * Product picture storage.
 *
 * The browsers sends a picture as a base64 data URL (`data:image/png;base64,....`),
 * this module validates it, writes it to `uploads/products/` and returns the short
 * public URL (`/uploads/products/<file>`) that the products table stores.
 *
 * AI Agent Note: the URL is stored in the database, the bytes are not. Ten gallery
 * pictures at a few hundred KB each would otherwise be re-sent with every product
 * list request. `server/index.ts` serves the directory with `express.static`, so the
 * URL can be used directly as an `<img src>`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** One featured picture + this many extra pictures per product. */
export const MAX_GALLERY_IMAGES = 10;

/** Largest decoded image accepted from the client (5 MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Public URL prefix of the upload directory; also used to recognise stored files. */
export const PRODUCT_IMAGE_URL_PREFIX = "/uploads/products/";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const PRODUCT_IMAGE_TYPES = Object.keys(EXTENSION_BY_MIME);

/** Absolute directory the pictures are written to (created on first upload). */
export const productImagesDir = path.resolve(process.cwd(), "uploads", "products");

/** An upload the user can fix (wrong format, too large) as opposed to a crash. */
export class ProductImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductImageError";
  }
}

/**
 * True for URLs this module produced (and for externally hosted http(s) images,
 * which are still accepted so a product can point at a CDN).
 */
export function isProductImageUrl(value: string): boolean {
  return (
    value.startsWith(PRODUCT_IMAGE_URL_PREFIX) ||
    /^https?:\/\//i.test(value)
  );
}

/**
 * Persist one base64 data URL and return its public URL.
 *
 * Throws `ProductImageError` when the payload is not a supported image so the route
 * can answer 400 instead of 500.
 */
export async function saveProductImage(dataUrl: string): Promise<string> {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new ProductImageError(
      "Invalid image data. Upload a JPEG, PNG, WebP, GIF or AVIF picture."
    );
  }

  const mime = match[1].toLowerCase();
  const extension = EXTENSION_BY_MIME[mime];

  if (!extension) {
    throw new ProductImageError(
      "Unsupported image format. Upload a JPEG, PNG, WebP, GIF or AVIF picture."
    );
  }

  // Stripping whitespace keeps screenshots-turned-data-URLs working.
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  if (buffer.length === 0) {
    throw new ProductImageError("The uploaded image is empty.");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ProductImageError(
      `The image is too large (${Math.round(buffer.length / 1024 / 1024)} MB). The limit is ${
        MAX_IMAGE_BYTES / 1024 / 1024
      } MB.`
    );
  }

  await fs.mkdir(productImagesDir, { recursive: true });

  // Timestamp first so the directory sorts chronologically; the UUID keeps two
  // uploads in the same millisecond apart.
  const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(productImagesDir, fileName), buffer);

  return `${PRODUCT_IMAGE_URL_PREFIX}${fileName}`;
}
