import type { AttachmentDto, AttachmentEntityType } from "@shared/attachments";

/**
 * Client side of the attachment endpoints.
 *
 * AI Agent Note - one picture per request. The API accepts a single `dataUrl` (see
 * `server/routes/attachments.ts`), so a phone's five screenshots are sent one after another
 * instead of in one multi-megabyte JSON body that `express.json`'s 10 MB limit would reject.
 */

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Request failed") as Error & { suggestion?: string };
    error.suggestion = body.suggestion;
    throw error;
  }
  return body;
}

function queryOf(entityType: AttachmentEntityType, entityId: number) {
  return new URLSearchParams({ entityType, entityId: String(entityId) });
}

/** The pictures already stored on one transaction, oldest first. */
export async function listAttachments(
  entityType: AttachmentEntityType,
  entityId: number
): Promise<AttachmentDto[]> {
  const response = await fetch(`/api/attachments?${queryOf(entityType, entityId)}`, {
    credentials: "include",
  });
  const body = await readJson(response);
  return (body.attachments ?? []) as AttachmentDto[];
}

/** Read a picked file as the base64 data URL the API expects. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`"${file.name}" could not be read from this device.`));
    reader.readAsDataURL(file);
  });
}

/** Upload one picture and return the stored row. */
export async function uploadAttachment(
  entityType: AttachmentEntityType,
  entityId: number,
  file: File
): Promise<AttachmentDto> {
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ entityType, entityId, fileName: file.name, dataUrl }),
  });
  const body = await readJson(response);
  return body.attachment as AttachmentDto;
}

export async function deleteAttachment(id: number): Promise<void> {
  const response = await fetch(`/api/attachments/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || "Request failed") as Error & { suggestion?: string };
    error.suggestion = body.suggestion;
    throw error;
  }
}

export interface AttachmentUploadResult {
  uploaded: number;
  /** Human-readable failures; a picture that fails does not stop the others. */
  failures: string[];
}

/**
 * Upload the pictures picked while a transaction was being created.
 *
 * Called right after the record exists (the id is only known then). A failure leaves the
 * transaction in place - the caller shows the message so the picture can be added afterwards from
 * the register - so this never throws.
 */
export async function uploadAttachmentFiles(
  entityType: AttachmentEntityType,
  entityId: number,
  files: File[]
): Promise<AttachmentUploadResult> {
  const result: AttachmentUploadResult = { uploaded: 0, failures: [] };

  for (const file of files) {
    try {
      await uploadAttachment(entityType, entityId, file);
      result.uploaded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push(`${file.name}: ${message}`);
    }
  }

  return result;
}
