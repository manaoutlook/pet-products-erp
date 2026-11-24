import { db } from "@db";
import {
  attachments,
  financeEntries,
  goodsReceipts,
  invoicePayments,
  purchaseOrders,
} from "@db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  ATTACHMENT_ENTITY_LABELS,
  MAX_ATTACHMENTS_PER_ENTITY,
  type AttachmentDto,
  type AttachmentEntityType,
} from "../shared/attachments";
import { AttachmentFileError, deleteAttachmentFile, saveAttachmentImage } from "./attachment-files";

/**
 * Proof documents service (`attachments` table).
 *
 * AI Agent Note - the table is polymorphic (`entity_type`, `entity_id`), so this module owns the
 * one place that knows which real table each kind points at. Writing a document therefore always
 * goes through `assertAttachmentEntity`, which refuses an id that does not exist: a typo cannot
 * leave an orphan picture behind.
 *
 * A transaction carries at most `MAX_ATTACHMENTS_PER_ENTITY` pictures. The count is checked
 * before the file is written and the rows are listed oldest first, so the register reads in the
 * order the documents were photographed.
 */

export class AttachmentError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = "AttachmentError";
    this.status = status;
    this.suggestion = suggestion;
  }
}

interface AttachmentFileInput {
  fileName: string;
  dataUrl: string;
}

/** The transaction table (and its id column) behind each attachment kind. */
const ENTITY_TABLE = {
  purchase_order: purchaseOrders,
  goods_receipt: goodsReceipts,
  invoice_payment: invoicePayments,
  finance_entry: financeEntries,
} as const;

const ENTITY_ID_COLUMN = {
  purchase_order: purchaseOrders.id,
  goods_receipt: goodsReceipts.id,
  invoice_payment: invoicePayments.id,
  finance_entry: financeEntries.id,
} as const;

/** Refuse a document for a transaction that does not exist (as a 404, not a 500). */
export async function assertAttachmentEntity(
  entityType: AttachmentEntityType,
  entityId: number
): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  const idColumn = ENTITY_ID_COLUMN[entityType];

  const [row] = await db
    .select({ id: idColumn })
    .from(table)
    .where(eq(idColumn, entityId))
    .limit(1);

  if (!row) {
    throw new AttachmentError(
      `${ATTACHMENT_ENTITY_LABELS[entityType]} not found`,
      404,
      "Reload the list and attach the picture to an existing transaction"
    );
  }
}

function toDto(row: typeof attachments.$inferSelect): AttachmentDto {
  return {
    id: row.id,
    entityType: row.entityType as AttachmentEntityType,
    entityId: row.entityId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    url: row.url,
    uploadedByUserId: row.uploadedByUserId ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

/** Every document on one transaction, oldest first. */
export async function listAttachments(
  entityType: AttachmentEntityType,
  entityId: number
): Promise<AttachmentDto[]> {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));

  return rows.map(toDto);
}

/** How many pictures are already attached (used to enforce the cap). */
export async function countAttachments(
  entityType: AttachmentEntityType,
  entityId: number
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachments)
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)));

  return row?.count ?? 0;
}


/**
 * Write one picture and record it against the transaction.
 *
 * The file is written first so a successful insert always has bytes behind it; when the insert
 * fails the file is removed again rather than left unusable in the upload directory.
 */
export async function attachImage(
  entityType: AttachmentEntityType,
  entityId: number,
  file: AttachmentFileInput,
  uploadedByUserId: number | null
): Promise<AttachmentDto> {
  await assertAttachmentEntity(entityType, entityId);

  const already = await countAttachments(entityType, entityId);
  if (already >= MAX_ATTACHMENTS_PER_ENTITY) {
    throw new AttachmentError(
      `This ${ATTACHMENT_ENTITY_LABELS[entityType].toLowerCase()} already has ` +
        `${MAX_ATTACHMENTS_PER_ENTITY} pictures`,
      400,
      `Remove one to add another - the limit is ${MAX_ATTACHMENTS_PER_ENTITY} per transaction`
    );
  }

  const { url, mimeType } = await saveAttachmentImage(file.dataUrl);

  try {
    const [row] = await db
      .insert(attachments)
      .values({
        entityType,
        entityId,
        fileName: file.fileName.trim().slice(0, 255) || "picture",
        mimeType,
        url,
        uploadedByUserId,
      })
      .returning();

    return toDto(row);
  } catch (error) {
    await deleteAttachmentFile(url);
    throw error;
  }
}

/** Load one document (the delete route needs its parent to check permissions). */
export async function getAttachment(
  id: number
): Promise<{ id: number; entityType: AttachmentEntityType; entityId: number } | null> {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    entityType: row.entityType as AttachmentEntityType,
    entityId: row.entityId,
  };
}

/** Remove one document and its file. */
export async function removeAttachment(id: number): Promise<void> {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);

  if (!row) {
    throw new AttachmentError("Picture not found", 404, "Reload the transaction");
  }

  await db.delete(attachments).where(eq(attachments.id, id));
  await deleteAttachmentFile(row.url);
}

/** One place that turns both kinds of attachment failure into the JSON the client reads. */
export function attachmentErrorBody(error: unknown, fallback: string) {
  if (error instanceof AttachmentError) {
    return {
      status: error.status,
      body: {
        message: error.message,
        ...(error.suggestion ? { suggestion: error.suggestion } : {}),
      },
    };
  }
  if (error instanceof AttachmentFileError) {
    return { status: error.status, body: { message: error.message } };
  }
  console.error(`${fallback}:`, error instanceof Error ? error.message : error);
  return { status: 500, body: { message: fallback, suggestion: "Please try again later" } };
}
