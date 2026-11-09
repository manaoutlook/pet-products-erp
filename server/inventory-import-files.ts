/**
 * Retention of the original file behind a bulk inventory import.
 *
 * The Inventory page parses the CSV/Excel in the browser and posts the parsed rows, so
 * without this module the bytes the user actually uploaded were gone the moment the
 * request finished - an import could not be re-checked, replayed or explained later.
 *
 * AI Agent Note: same trade-off as signed delivery notes
 * (`server/delivery-note-documents.ts`) - the URL is stored, not the bytes, and
 * `server/index.ts` serves `uploads/` with `express.static`. The file arrives as a base64
 * data URL because the routes speak JSON; the decoded file is capped well below the 10 MB
 * JSON body limit so the rows and the file fit in one request.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Largest decoded spreadsheet kept (5 MB) - larger files would not fit the JSON body. */
export const MAX_INVENTORY_IMPORT_BYTES = 5 * 1024 * 1024;

/** Public URL prefix of the import directory; also used to recognise stored files. */
export const INVENTORY_IMPORT_URL_PREFIX = "/uploads/inventory-imports/";

const EXTENSION_BY_MIME: Record<string, string> = {
  "text/csv": "csv",
  "text/comma-separated-values": "csv",
  "application/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const SUPPORTED_EXTENSIONS = ["csv", "xlsx", "xls"];

/** Absolute directory the import files are written to (created on first upload). */
export const inventoryImportFilesDir = path.resolve(
  process.cwd(),
  "uploads",
  "inventory-imports"
);

/** An upload the user can fix (wrong format, too large) as opposed to a crash. */
export class InventoryImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryImportFileError";
  }
}

export interface InventoryImportFileInput {
  fileName: string;
  mimeType?: string | null;
  /** `data:<mime>;base64,<bytes>` produced by the browser's FileReader. */
  dataUrl: string;
}

export interface StoredInventoryImportFile {
  originalFileName: string;
  storedFileUrl: string;
  mimeType: string | null;
  fileSize: number;
}

/** True for URLs this module produced. */
export function isInventoryImportFileUrl(value: string): boolean {
  return value.startsWith(INVENTORY_IMPORT_URL_PREFIX);
}

/** Keep only characters that are safe in a directory listing / download name. */
function safeBaseName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^A-Za-z0-9._-]+/g, "_");
  return base.slice(-80) || "inventory-import";
}

/**
 * Persist one uploaded spreadsheet and return what goes on the import record.
 *
 * Throws `InventoryImportFileError` when the payload is not a supported spreadsheet so the
 * route can answer 400 instead of 500.
 */
export async function saveInventoryImportFile(
  input: InventoryImportFileInput
): Promise<StoredInventoryImportFile> {
  const originalFileName = path.basename(input.fileName.trim());
  const extensionFromName = originalFileName.split(".").pop()?.toLowerCase() ?? "";
  const extension = SUPPORTED_EXTENSIONS.includes(extensionFromName)
    ? extensionFromName
    : EXTENSION_BY_MIME[(input.mimeType ?? "").toLowerCase()];

  if (!extension || !SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new InventoryImportFileError(
      "Unsupported file. Upload a .csv, .xlsx or .xls spreadsheet."
    );
  }

  const match = /^data:[^;,]*;base64,([\s\S]+)$/i.exec(input.dataUrl.trim());
  if (!match) {
    throw new InventoryImportFileError(
      "Invalid file data. Upload the spreadsheet again."
    );
  }

  const buffer = Buffer.from(match[1].replace(/\s/g, ""), "base64");

  if (buffer.length === 0) {
    throw new InventoryImportFileError("The uploaded file is empty.");
  }

  if (buffer.length > MAX_INVENTORY_IMPORT_BYTES) {
    throw new InventoryImportFileError(
      `The file is too large (${Math.round(buffer.length / 1024 / 1024)} MB). The limit is ${
        MAX_INVENTORY_IMPORT_BYTES / 1024 / 1024
      } MB.`
    );
  }

  await fs.mkdir(inventoryImportFilesDir, { recursive: true });

  // Timestamp first so the directory sorts chronologically; the UUID keeps two uploads
  // in the same millisecond apart.
  const storedName = `${Date.now()}-${randomUUID()}-${safeBaseName(originalFileName)}`;
  await fs.writeFile(path.join(inventoryImportFilesDir, storedName), buffer);

  return {
    originalFileName: originalFileName || `inventory-import.${extension}`,
    storedFileUrl: `${INVENTORY_IMPORT_URL_PREFIX}${storedName}`,
    mimeType: input.mimeType?.trim() || EXTENSION_BY_MIME[extension] || null,
    fileSize: buffer.length,
  };
}
