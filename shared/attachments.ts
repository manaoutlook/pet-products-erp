/**
 * Proof documents on a transaction: the paper receipt photographed at the counter, the
 * bank-transfer screenshot, the supplier's delivery note, the customs paperwork on an import.
 *
 * AI Agent Note - one polymorphic table (`attachments.entity_type` + `entity_id`), not a photo
 * column per screen. The four kinds below are the transactions money or goods move on, and the
 * upload UI is the same for all of them (`AttachmentUploader` / `PendingAttachmentPicker`), so a
 * new kind is a line here plus its table in `server/attachments.ts` - nothing else.
 *
 * A transaction may carry up to `MAX_ATTACHMENTS_PER_ENTITY` pictures. The floor the business
 * asked for is five (a receipt photo, the bank screenshot, the delivery note, ...), so the cap is
 * deliberately above it rather than exactly five.
 */

export const ATTACHMENT_ENTITY_TYPES = [
  "purchase_order",
  "goods_receipt",
  "invoice_payment",
  "finance_entry",
] as const;

export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

/** How many pictures one transaction can carry (the requested minimum is five). */
export const MAX_ATTACHMENTS_PER_ENTITY = 10;

/** Largest decoded picture accepted - the same ceiling products use. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Public URL prefix; `server/index.ts` serves `uploads/` statically. */
export const ATTACHMENT_URL_PREFIX = "/uploads/attachments/";

export const ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** `accept` attribute for the file input - phones offer the camera for the image types. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_IMAGE_MIME_TYPES.join(",");

export const ATTACHMENT_ENTITY_LABELS: Record<AttachmentEntityType, string> = {
  purchase_order: "Purchase order",
  goods_receipt: "Goods receipt",
  invoice_payment: "Customer receipt",
  finance_entry: "Finance entry",
};

/**
 * The permission module that owns each kind of transaction. Reading or changing the documents of
 * a transaction requires the same module as the transaction itself, so a role that cannot see
 * finance entries cannot read their bank screenshots either.
 */
export const ATTACHMENT_ENTITY_MODULES: Record<AttachmentEntityType, string> = {
  purchase_order: "purchaseOrders",
  goods_receipt: "purchaseOrders",
  invoice_payment: "receipts",
  finance_entry: "finance",
};

export function isAttachmentEntityType(value: string): value is AttachmentEntityType {
  return (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isAttachmentMimeType(mime: string): boolean {
  return (ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/**
 * Why one picked file cannot be attached, or `null` when it can.
 *
 * Shared by the client (reject before reading the file) and the server (reject before writing it),
 * so the message a user sees and the rule the API enforces cannot drift apart.
 */
export function attachmentFileError(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (file.size === 0) {
    return `"${file.name}" is empty. Choose the picture again.`;
  }
  if (!isAttachmentMimeType(file.type)) {
    return `"${file.name}" is not a picture. Attach a JPEG, PNG, WebP, GIF or AVIF photo or screenshot.`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    const megabytes = Math.round((file.size / 1024 / 1024) * 10) / 10;
    return `"${file.name}" is ${megabytes} MB. The limit is ${
      MAX_ATTACHMENT_BYTES / 1024 / 1024
    } MB per picture.`;
  }
  return null;
}

/** One stored document, as `GET /api/attachments` returns it. */
export interface AttachmentDto {
  id: number;
  entityType: AttachmentEntityType;
  entityId: number;
  /** The name the file had on the phone/desktop, kept so the list means something to a human. */
  fileName: string;
  mimeType: string;
  /** `/uploads/attachments/<file>` - directly usable as an `<img src>` or download link. */
  url: string;
  uploadedByUserId: number | null;
  createdAt: string | null;
}

/** The one-line explanation under every picker. */
export const ATTACHMENT_HELP_TEXT =
  `Photos of the receipt, the bank-transfer screenshot or the related paperwork - ` +
  `up to ${MAX_ATTACHMENTS_PER_ENTITY} pictures, ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB each.`;
