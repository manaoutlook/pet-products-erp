import type * as XLSXType from "xlsx";

/**
 * Helpers behind the Inventory Management page **Export** and **Import**
 * buttons. Mirrors `product-spreadsheet.ts`.
 *
 * - `exportInventory` writes the visible inventory rows to .xlsx or .csv.
 * - `readSpreadsheetFile` reads a .csv/.xlsx/.xls file and maps its headers onto
 *   the canonical inventory import fields that `POST /api/inventory/import`
 *   expects.
 *
 * SheetJS is loaded lazily (dynamic import) so the parser is only downloaded
 * when the user actually exports or imports.
 */

const loadXlsx = (): Promise<typeof XLSXType> => import("xlsx");

export type InventoryImportFieldKey =
  | "productSku"
  | "productName"
  | "inventoryType"
  | "store"
  | "supplier"
  | "quantity"
  | "location"
  | "purchaseDate"
  | "expiryDate";

interface ImportFieldDefinition {
  key: InventoryImportFieldKey;
  label: string;
  /**
   * Accepted header spellings, most specific first. The first alias that is
   * present in the file wins, so "Product SKU" beats the generic "SKU".
   */
  aliases: string[];
  required?: boolean;
}

export const INVENTORY_IMPORT_FIELDS: ImportFieldDefinition[] = [
  { key: "productSku", label: "Product SKU", aliases: ["productsku", "sku", "skucode", "productcode", "itemcode", "code"], required: true },
  { key: "productName", label: "Product Name", aliases: ["productname", "product", "name", "itemname", "title"] },
  { key: "inventoryType", label: "Inventory Type", aliases: ["inventorytype", "type", "stocktype", "locationtype"], required: true },
  { key: "store", label: "Store", aliases: ["store", "storename", "warehouse", "warehousename", "dc", "centername", "centrename"] },
  { key: "supplier", label: "Supplier", aliases: ["supplier", "suppliername", "vendor", "vendorname"] },
  { key: "quantity", label: "Quantity", aliases: ["quantity", "qty", "stock", "stockquantity", "onhand", "onhandquantity", "onhandqty"], required: true },
  { key: "location", label: "Location", aliases: ["location", "locationdetail", "rack", "shelf", "bin", "physicallocation", "physicalrack", "storage"] },
  { key: "purchaseDate", label: "Purchase Date", aliases: ["purchasedate", "purchase", "receiveddate", "datepurchased"] },
  { key: "expiryDate", label: "Expiry Date", aliases: ["expirydate", "expirationdate", "expiry", "expiration", "bestbefore"] },
];

/** Header text -> lookup key: lower case, letters/digits only. */
export const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

const isBlankCell = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

/** Maps the header row of a file onto the canonical import fields. */
export function mapHeaders(headers: string[]): {
  fields: Partial<Record<InventoryImportFieldKey, number>>;
  unmatched: string[];
  missingRequired: string[];
} {
  const normalized = headers.map((header) => normalizeHeader(String(header ?? "")));
  const fields: Partial<Record<InventoryImportFieldKey, number>> = {};
  const usedColumns = new Set<number>();

  for (const definition of INVENTORY_IMPORT_FIELDS) {
    for (const alias of definition.aliases) {
      // Column order decides which duplicate header wins.
      const columnIndex = normalized.findIndex(
        (header, index) => header === alias && !usedColumns.has(index)
      );
      if (columnIndex > -1) {
        fields[definition.key] = columnIndex;
        usedColumns.add(columnIndex);
        break;
      }
    }
  }

  const unmatched = headers.filter(
    (header, index) => !usedColumns.has(index) && String(header ?? "").trim() !== ""
  );
  const missingRequired = INVENTORY_IMPORT_FIELDS.filter(
    (definition) => definition.required && fields[definition.key] === undefined
  ).map((definition) => definition.label);

  return { fields, unmatched, missingRequired };
}

export interface ParsedInventorySpreadsheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  /** Canonical-field rows, ready to be posted to /api/inventory/import */
  rows: Record<string, unknown>[];
  /** Human readable preview (first rows, original cell values) */
  preview: Record<InventoryImportFieldKey, unknown>[];
  unmatchedHeaders: string[];
  missingRequiredHeaders: string[];
}

const PREVIEW_ROWS = 8;

export async function readSpreadsheetFile(file: File): Promise<ParsedInventorySpreadsheet> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();

  let workbook: XLSXType.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  } catch {
    throw new Error(
      "The file could not be read. Make sure it is a valid .csv, .xlsx or .xls file."
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The file does not contain any sheet.");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });

  if (matrix.length === 0) {
    throw new Error("The selected sheet is empty.");
  }

  const headers = (matrix[0] as unknown[]).map((cell) => String(cell ?? "").trim());
  const { fields, unmatched, missingRequired } = mapHeaders(headers);

  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required column${missingRequired.length > 1 ? "s" : ""}: ${missingRequired.join(", ")}. ` +
        "Download the template to see the expected headers."
    );
  }

  const rows: Record<string, unknown>[] = [];
  const preview: Record<InventoryImportFieldKey, unknown>[] = [];

  for (const rawRow of matrix.slice(1) as unknown[][]) {
    const cells = Array.isArray(rawRow) ? rawRow : [];
    if (!cells.some((cell) => !isBlankCell(cell))) continue;

    const row: Record<string, unknown> = {};
    const previewRow = {} as Record<InventoryImportFieldKey, unknown>;

    for (const definition of INVENTORY_IMPORT_FIELDS) {
      const columnIndex = fields[definition.key];
      const value = columnIndex === undefined ? "" : cells[columnIndex];
      row[definition.key] = value ?? "";
      previewRow[definition.key] = value ?? "";
    }

    rows.push(row);
    if (preview.length < PREVIEW_ROWS) preview.push(previewRow);
  }

  return {
    fileName: file.name,
    sheetName,
    headers,
    rows,
    preview,
    unmatchedHeaders: unmatched,
    missingRequiredHeaders: missingRequired,
  };
}

/** Minimal shape of an inventory row returned by `GET /api/inventory`. */
export interface ExportableInventory {
  quantity: number;
  location?: string | null;
  inventoryType?: string | null;
  barcode?: string | null;
  purchaseDate?: string | Date | null;
  expiryDate?: string | Date | null;
  product?: { name: string; sku: string; minStock?: number | null } | null;
  store?: { name: string } | null;
  supplier?: { name: string } | null;
}

export type ExportFormat = "xlsx" | "csv";

const inventoryTypeLabel = (value: string | null | undefined): string => {
  if (!value) return "";
  return value === "DC" ? "Distribution Center" : value === "STORE" ? "Retail Store" : value;
};

const dateCell = (value: string | Date | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Dates come back from the API as ISO strings; keep just the day part.
  return String(value).slice(0, 10);
};

const stockStatus = (item: ExportableInventory): string => {
  const minStock = item.product?.minStock ?? 0;
  if (item.quantity <= 0) return "Out of Stock";
  if (item.quantity <= minStock) return "Low Stock";
  return "In Stock";
};

/** Column order of the export file - also the column order of the template. */
export const EXPORT_COLUMNS: {
  header: string;
  value: (item: ExportableInventory) => string | number;
}[] = [
  { header: "Product Name", value: (item) => item.product?.name ?? "" },
  { header: "Product SKU", value: (item) => item.product?.sku ?? "" },
  { header: "Inventory Type", value: (item) => inventoryTypeLabel(item.inventoryType) },
  { header: "Store", value: (item) => item.store?.name ?? "" },
  { header: "Supplier", value: (item) => item.supplier?.name ?? "" },
  { header: "Quantity", value: (item) => item.quantity },
  { header: "Location", value: (item) => item.location ?? "" },
  { header: "Purchase Date", value: (item) => dateCell(item.purchaseDate) },
  { header: "Expiry Date", value: (item) => dateCell(item.expiryDate) },
  { header: "Barcode", value: (item) => item.barcode ?? "" },
  { header: "Status", value: (item) => stockStatus(item) },
];

const dateStamp = (): string => new Date().toISOString().slice(0, 10);

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Writes the given inventory rows to a downloadable .xlsx/.csv file and returns
 * the file name (useful for toasts/tests).
 */
export async function exportInventory(
  items: ExportableInventory[],
  format: ExportFormat
): Promise<string> {
  const XLSX = await loadXlsx();

  const data = items.map((item) => {
    const row: Record<string, string | number> = {};
    for (const column of EXPORT_COLUMNS) {
      row[column.header] = column.value(item);
    }
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(data, {
    header: EXPORT_COLUMNS.map((column) => column.header),
  });
  sheet["!cols"] = EXPORT_COLUMNS.map((column) => ({ wch: Math.max(column.header.length + 2, 14) }));

  const fileName = `inventory-${dateStamp()}.${format}`;

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // The BOM keeps Excel from mangling non-ASCII names.
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), fileName);
    return fileName;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Inventory");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
  return fileName;
}

/** Downloads an import template (headers + one sample row) as .xlsx or .csv. */
export async function downloadImportTemplate(format: ExportFormat = "xlsx"): Promise<string> {
  const XLSX = await loadXlsx();

  const sample: Record<string, string | number> = {
    "Product SKU": "SAMPLE-001",
    "Product Name": "Sample Product",
    "Inventory Type": "Distribution Center",
    Store: "Main Warehouse",
    Supplier: "Acme Trading",
    Quantity: 100,
    Location: "Rack A, Shelf 2",
    "Purchase Date": "2024-10-15",
    "Expiry Date": "2026-10-15",
  };

  // The template columns mirror exactly the importable fields (the same list the
  // importer parses headers against). Barcode/Status are export-only and are not
  // part of the template.
  const headers = INVENTORY_IMPORT_FIELDS.map((field) => field.label);
  const sheet = XLSX.utils.json_to_sheet([sample], { header: headers });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 2, 14) }));

  const fileName = `inventory-import-template.${format}`;

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // The BOM keeps Excel from mangling non-ASCII names.
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), fileName);
    return fileName;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Inventory");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
  return fileName;
}
