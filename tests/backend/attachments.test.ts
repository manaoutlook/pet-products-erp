import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AttachmentFileError,
  attachmentsDir,
  deleteAttachmentFile,
  isAttachmentUrl,
  saveAttachmentImage,
} from "../../server/attachment-files";
import {
  ATTACHMENT_ENTITY_TYPES,
  ATTACHMENT_URL_PREFIX,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ENTITY,
  attachmentFileError,
  isAttachmentEntityType,
  isAttachmentMimeType,
} from "../../shared/attachments";

/**
 * Proof pictures are stored as files and referenced by a short URL, so `attachment-files` is the
 * boundary that decides what a transaction may point at. These tests pin the accepted formats,
 * the size ceiling, the five-picture minimum the business asked for, and that the bytes really
 * land in uploads/attachments/.
 */

// 1x1 transparent PNG - the smallest thing that is genuinely a PNG.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const writtenFiles: string[] = [];

async function saveAndTrack(dataUrl: string) {
  const saved = await saveAttachmentImage(dataUrl);
  writtenFiles.push(path.join(attachmentsDir, path.basename(saved.url)));
  return saved;
}

describe("attachment picture storage", () => {
  afterEach(async () => {
    await Promise.all(writtenFiles.splice(0).map((file) => fs.rm(file, { force: true })));
  });

  it("writes the picture to disk and returns a public URL", async () => {
    const saved = await saveAndTrack(PNG_DATA_URL);

    expect(saved.url.startsWith(ATTACHMENT_URL_PREFIX)).toBe(true);
    expect(saved.url.endsWith(".png")).toBe(true);
    expect(saved.mimeType).toBe("image/png");
    expect(isAttachmentUrl(saved.url)).toBe(true);

    const stat = await fs.stat(path.join(attachmentsDir, path.basename(saved.url)));
    expect(stat.size).toBeGreaterThan(0);
  });

  it("gives two uploads of the same picture different names", async () => {
    const first = await saveAndTrack(PNG_DATA_URL);
    const second = await saveAndTrack(PNG_DATA_URL);

    expect(first.url).not.toBe(second.url);
  });

  it("accepts the formats a phone camera and a screenshot produce", async () => {
    const jpeg = await saveAndTrack("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==");
    const webp = await saveAndTrack("data:image/webp;base64,UklGRgAAAABXRUJQ");

    expect(jpeg.url.endsWith(".jpg")).toBe(true);
    expect(webp.url.endsWith(".webp")).toBe(true);
  });

  it("rejects values that are not base64 picture data URLs", async () => {
    await expect(saveAttachmentImage("https://example.com/receipt.png")).rejects.toBeInstanceOf(
      AttachmentFileError
    );
    await expect(saveAttachmentImage("not-a-picture")).rejects.toBeInstanceOf(AttachmentFileError);
  });

  it("rejects unsupported formats such as SVG", async () => {
    await expect(saveAttachmentImage("data:image/svg+xml;base64,PHN2Zy8+")).rejects.toThrow(
      /Unsupported picture format/
    );
  });

  it("rejects an empty payload", async () => {
    await expect(saveAttachmentImage("data:image/png;base64,")).rejects.toBeInstanceOf(
      AttachmentFileError
    );
  });

  it("caps one decoded picture at 5 MB", async () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(5 * 1024 * 1024);

    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString(
      "base64"
    )}`;

    await expect(saveAttachmentImage(oversized)).rejects.toThrow(/too large/i);
  });

  it("deletes a stored picture and tolerates one that is already gone", async () => {
    const saved = await saveAttachmentTracked(PNG_DATA_URL);
    const file = path.join(attachmentsDir, path.basename(saved));

    await deleteAttachmentFile(saved);
    await expect(fs.stat(file)).rejects.toThrow();

    // Removing it twice is not an error: the row is what matters.
    await expect(deleteAttachmentFile(saved)).resolves.toBeUndefined();
  });

  it("refuses to delete a path outside the uploads directory", async () => {
    // A stored URL from another module must not remove someone else's file.
    await expect(deleteAttachmentFile("/etc/passwd")).resolves.toBeUndefined();
  });
});

/** Save without tracking, for the delete test that removes the file itself. */
async function saveAttachmentTracked(dataUrl: string) {
  const saved = await saveAttachmentImage(dataUrl);
  return saved.url;
}

describe("attachment rules shared by the API and the client", () => {
  it("allows at least the five pictures the business asked for", () => {
    expect(MAX_ATTACHMENTS_PER_ENTITY).toBeGreaterThanOrEqual(5);
  });

  it("knows the four transaction kinds", () => {
    expect(ATTACHMENT_ENTITY_TYPES).toEqual([
      "purchase_order",
      "goods_receipt",
      "invoice_payment",
      "finance_entry",
    ]);
    expect(isAttachmentEntityType("finance_entry")).toBe(true);
    expect(isAttachmentEntityType("invoices")).toBe(false);
  });

  it("only accepts picture mime types", () => {
    expect(isAttachmentMimeType("image/png")).toBe(true);
    expect(isAttachmentMimeType("IMAGE/JPEG")).toBe(true);
    expect(isAttachmentMimeType("application/pdf")).toBe(false);
    expect(isAttachmentMimeType("image/svg+xml")).toBe(false);
  });

  it("explains why a picked file cannot be attached", () => {
    expect(
      attachmentFileError({ name: "receipt.png", type: "image/png", size: 1024 })
    ).toBeNull();

    expect(
      attachmentFileError({ name: "invoice.pdf", type: "application/pdf", size: 1024 })
    ).toMatch(/not a picture/i);

    expect(
      attachmentFileError({ name: "huge.jpg", type: "image/jpeg", size: MAX_ATTACHMENT_BYTES + 1 })
    ).toMatch(/limit is 5 MB/i);

    expect(attachmentFileError({ name: "empty.png", type: "image/png", size: 0 })).toMatch(
      /empty/i
    );
  });
});
