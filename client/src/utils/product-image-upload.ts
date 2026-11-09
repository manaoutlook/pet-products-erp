/**
 * Product picture upload helper.
 *
 * Pictures are compressed in the browser before they are sent: a phone photo is
 * several megabytes, which would blow past the JSON body limit and be slow to
 * upload. The image is scaled down to at most 1200px on its long edge and re-encoded
 * as JPEG (PNG keeps its alpha channel), then posted to POST /api/products/images.
 * The API writes the file and returns the short URL that is saved on the product.
 */

/** One featured picture + this many extra pictures per product. */
export const MAX_PRODUCT_GALLERY_IMAGES = 10;

/** Largest file the user may pick, before compression. */
export const MAX_PRODUCT_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

const MAX_UPLOAD_DIMENSION = 1200;
const JPEG_QUALITY = 0.82;
// Images that are already small are uploaded untouched (re-encoding a small PNG
// can make it bigger).
const SKIP_COMPRESSION_UNDER_BYTES = 250 * 1024;

/** Readable message for any error thrown by `uploadProductImage`. */
export class ProductImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductImageUploadError";
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ProductImageUploadError("The picture could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ProductImageUploadError("The picture could not be decoded."));
    image.src = src;
  });
}

/**
 * Scale the picture down and re-encode it. Returns the original data URL when the
 * picture is already small enough or the canvas is unavailable.
 */
async function compressImage(file: File, dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const longEdge = Math.max(image.width, image.height);
  const needsResize = longEdge > MAX_UPLOAD_DIMENSION;
  const needsReencode = file.size > SKIP_COMPRESSION_UNDER_BYTES;

  if (!needsResize && !needsReencode) return dataUrl;

  const scale = needsResize ? MAX_UPLOAD_DIMENSION / longEdge : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  context.drawImage(image, 0, 0, width, height);

  // PNG keeps transparency; everything else becomes a JPEG, which is much smaller.
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const compressed = canvas.toDataURL(outputType, JPEG_QUALITY);

  return compressed.length < dataUrl.length ? compressed : dataUrl;
}

/**
 * Compress one picture and POST it to `endpoint` as `{ image: <data URL> }`, returning the URL
 * the server stored.
 *
 * Shared by every upload screen - product pictures and the signed delivery note - so the
 * browser-side limits and the compression live in one place; only the endpoint (and therefore
 * the storage directory) differs.
 *
 * Throws `ProductImageUploadError` with a user-readable message on failure; the caller shows it
 * in a toast.
 */
export async function uploadImageFile(file: File, endpoint: string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ProductImageUploadError(`${file.name} is not an image file.`);
  }

  if (file.size > MAX_PRODUCT_IMAGE_FILE_BYTES) {
    throw new ProductImageUploadError(
      `${file.name} is larger than ${MAX_PRODUCT_IMAGE_FILE_BYTES / 1024 / 1024} MB.`
    );
  }

  const rawDataUrl = await readAsDataUrl(file);
  const dataUrl = await compressImage(file, rawDataUrl);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
      credentials: "include",
    });
  } catch {
    throw new ProductImageUploadError("The picture could not be uploaded. Check your connection.");
  }

  if (!response.ok) {
    let message = `Failed to upload ${file.name}`;
    try {
      const body = await response.json();
      if (body && typeof body.message === "string" && body.message.trim()) {
        message = body.message;
      }
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new ProductImageUploadError(message);
  }

  const body = (await response.json()) as { url?: string };
  if (!body?.url) {
    throw new ProductImageUploadError("The server did not return an image URL.");
  }

  return body.url;
}

/**
 * Compress and upload one product picture, returning the URL to store on the product.
 * The API writes the file and returns the short URL that is saved on the product.
 */
export function uploadProductImage(file: File): Promise<string> {
  return uploadImageFile(file, "/api/products/images");
}
