import type * as XLSXType from "xlsx";

/**
 * Helpers behind the **Import** buttons of the master data screens
 * (Categories, Brands, Suppliers).
 *
 * - `readMasterDataFile` reads a .csv/.xlsx/.xls file and maps its headers onto
 *   the canonical fields that `POST /api/{categories,brands,suppliers}/import`
 *   expects.
 * - `downloadMasterDataTemplate` writes a one-row template for the screen.
 * - `exportMasterData` writes the rows currently shown on the screen to a
 *   .csv/.xlsx file using the same headers, so exports can be re-imported.
 *
 * SheetJS is loaded lazily (dynamic import) so the parser is only downloaded
 * when the user actually imports or exports.
 */

const loadXlsx = (): Promise<typeof XLSXType> => import("xlsx");

export type MasterDataKind = "categories" | "brands" | "suppliers";

export type MasterDataFieldKey =
  // categories
  | "name"
  | "description"
  | "parent"
  // suppliers
  | "contactInfo"
  | "address";

export interface MasterDataFieldDefinition {
  key: MasterDataFieldKey;
  label: string;
  /**
   * Accepted header spellings, most specific first. The first alias that is
   * present in the file wins, so "Parent Category" beats the generic "Parent".
   */
  aliases: string[];
  required?: boolean;
  /** Value used by the downloadable template */
  sample: string;
}

export interface MasterDataDefinition {
  kind: MasterDataKind;
  /** "category" / "brand" / "supplier" */
  singular: string;
  /** "categories" / "brands" / "suppliers" */
  plural: string;
  /** Dialog title, e.g. "Import Categories" */
  title: string;
  /** REST collection, the import endpoint is `${endpoint}/import` */
  endpoint: string;
  templateFileName: string;
  fields: MasterDataFieldDefinition[];
}

const NAME_FIELD: MasterDataFieldDefinition = {
  key: "name",
  label: "Name",
  aliases: ["name", "categoryname", "brandname", "suppliername", "vendorname", "vendor", "category", "brand", "supplier"],
  required: true,
  sample: "",
};

const DESCRIPTION_FIELD: MasterDataFieldDefinition = {
  key: "description",
  label: "Description",
  aliases: ["description", "notes", "note", "details", "desc"],
  sample: "",
};

export const MASTER_DATA: Record<MasterDataKind, MasterDataDefinition> = {
  categories: {
    kind: "categories",
    singular: "category",
    plural: "categories",
    title: "Import Categories",
    endpoint: "/api/categories",
    templateFileName: "category-import-template",
    fields: [
      { ...NAME_FIELD, label: "Category Name", aliases: ["categoryname", "name", "category", "subcategoryname", "subcategory", "title"], sample: "Dog Food" },
      {
        ...DESCRIPTION_FIELD,
        label: "Description",
        aliases: ["description", "categorydescription", "notes", "note", "details", "desc"],
        sample: "Dry food for adult dogs",
      },
      {
        key: "parent",
        label: "Parent Category",
        aliases: ["parentcategory", "parentcategoryname", "parent", "parentname", "subcategoryof", "under"],
        sample: "Dogs",
      },
    ],
  },
  brands: {
    kind: "brands",
    singular: "brand",
    plural: "brands",
    title: "Import Brands",
    endpoint: "/api/brands",
    templateFileName: "brand-import-template",
    fields: [
      { ...NAME_FIELD, label: "Brand Name", aliases: ["brandname", "name", "brand", "title"], sample: "Pedigree" },
      {
        ...DESCRIPTION_FIELD,
        label: "Description",
        aliases: ["description", "branddescription", "notes", "note", "details", "desc"],
        sample: "Dog food brand",
      },
    ],
  },
  suppliers: {
    kind: "suppliers",
    singular: "supplier",
    plural: "suppliers",
    title: "Import Suppliers",
    endpoint: "/api/suppliers",
    templateFileName: "supplier-import-template",
    fields: [
      { ...NAME_FIELD, label: "Supplier Name", aliases: ["suppliername", "name", "supplier", "vendor", "vendorname", "title"], sample: "Acme Trading" },
      {
        key: "contactInfo",
        label: "Contact Information",
        aliases: ["contactinformation", "contactinfo", "contactdetails", "contact", "phone", "phonenumber", "email"],
        required: true,
        sample: "0901234567",
      },
      {
        key: "address",
        label: "Address",
        aliases: ["address", "supplieraddress", "location", "streetaddress"],
        required: true,
        sample: "12 Nguyen Hue, District 1, HCMC",
      },
    ],
  },
};

/** Header text -> lookup key: lower case, letters/digits only. */
export const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

const isBlankCell = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

/** Maps the header row of a file onto the canonical import fields. */
export function mapMasterDataHeaders(
  kind: MasterDataKind,
  headers: string[]
): {
  fields: Partial<Record<MasterDataFieldKey, number>>;
  unmatched: string[];
  missingRequired: string[];
} {
  const { fields: definitions } = MASTER_DATA[kind];
  const normalized = headers.map((header) => normalizeHeader(String(header ?? "")));
  const fields: Partial<Record<MasterDataFieldKey, number>> = {};
  const usedColumns = new Set<number>();

  for (const definition of definitions) {
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
    (header, index) => !usedColumns.has(index) && normalized[index] !== ""
  );

  const missingRequired = definitions
    .filter((definition) => definition.required && fields[definition.key] === undefined)
    .map((definition) => definition.label);

  return { fields, unmatched, missingRequired };
}

export interface ParsedMasterDataSpreadsheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  /** Canonical-field rows, ready to be posted to `/api/<kind>/import` */
  rows: Record<string, unknown>[];
  /** Human readable preview (first rows, original cell values) */
  preview: Record<string, unknown>[];
  unmatchedHeaders: string[];
  missingRequiredHeaders: string[];
}

const PREVIEW_ROWS = 8;

export async function readMasterDataFile(
  kind: MasterDataKind,
  file: File
): Promise<ParsedMasterDataSpreadsheet> {
  const definition = MASTER_DATA[kind];
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
    // Every master data field is text, so the cells are read as displayed
    // (`raw: false`). Otherwise a phone number such as "0901234567" would come
    // back as the number 901234567 and silently lose its leading zero.
    raw: false,
  });

  if (matrix.length === 0) {
    throw new Error("The selected sheet is empty.");
  }

  const headers = (matrix[0] as unknown[]).map((cell) => String(cell ?? "").trim());
  const { fields, unmatched, missingRequired } = mapMasterDataHeaders(kind, headers);

  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required column${missingRequired.length > 1 ? "s" : ""}: ${missingRequired.join(", ")}. ` +
        "Download the template to see the expected headers."
    );
  }

  const rows: Record<string, unknown>[] = [];
  const preview: Record<string, unknown>[] = [];

  for (const rawRow of matrix.slice(1) as unknown[][]) {
    const cells = Array.isArray(rawRow) ? rawRow : [];
    if (!cells.some((cell) => !isBlankCell(cell))) continue;

    const row: Record<string, unknown> = {};
    const previewRow: Record<string, unknown> = {};

    for (const field of definition.fields) {
      const columnIndex = fields[field.key];
      const value = columnIndex === undefined ? "" : cells[columnIndex];
      row[field.key] = value ?? "";
      previewRow[field.key] = value ?? "";
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

export type SpreadsheetFormat = "xlsx" | "csv";

/** Minimal shapes of the rows returned by the master data list endpoints. */
export interface ExportableCategory {
  name: string;
  description?: string | null;
  parentId?: number | null;
  parent?: { name: string | null } | null;
}

export interface ExportableBrand {
  name: string;
  description?: string | null;
}

export interface ExportableSupplier {
  name: string;
  contactInfo?: string | null;
  address?: string | null;
}

/**
 * A row to export. The list endpoints return one of the shapes above, so a row
 * is simply a partial of all of them (only the fields of its own screen exist).
 */
export type MasterDataExportRow = Partial<ExportableCategory> &
  Partial<ExportableBrand> &
  Partial<ExportableSupplier>;

export interface MasterDataExportOptions {
  /**
   * id -> category name. `GET /api/categories` returns flat rows with only
   * `parentId`, so the parent column of the export is resolved from this map.
   */
  categoryNames?: Map<number, string> | Record<number, string>;
}

const toCellText = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

function parentNameOf(row: MasterDataExportRow, options: MasterDataExportOptions): string {
  if (row.parent?.name) return row.parent.name;
  if (row.parentId === null || row.parentId === undefined) return "";

  const names = options.categoryNames;
  if (!names) return "";

  return (names instanceof Map ? names.get(row.parentId) : names[row.parentId]) ?? "";
}

const EXPORT_CELL: Record<
  MasterDataFieldKey,
  (row: MasterDataExportRow, options: MasterDataExportOptions) => string
> = {
  name: (row) => toCellText(row.name),
  description: (row) => toCellText(row.description),
  parent: (row, options) => parentNameOf(row, options),
  contactInfo: (row) => toCellText(row.contactInfo),
  address: (row) => toCellText(row.address),
};

/**
 * Writes the given master data rows to a downloadable .xlsx/.csv file and
 * returns the file name (useful for toasts/tests).
 *
 * The column headers are the import template labels, so an exported file can be
 * imported back unchanged (and the importer keeps every value as text, which
 * preserves leading zeros in phone numbers).
 */
export async function exportMasterData(
  kind: MasterDataKind,
  rows: MasterDataExportRow[],
  format: SpreadsheetFormat,
  options: MasterDataExportOptions = {}
): Promise<string> {
  const definition = MASTER_DATA[kind];
  const XLSX = await loadXlsx();

  const headers = definition.fields.map((field) => field.label);
  const data = rows.map((row) => {
    const cells: Record<string, string> = {};
    for (const field of definition.fields) {
      cells[field.label] = EXPORT_CELL[field.key](row, options);
    }
    return cells;
  });

  const sheet = XLSX.utils.json_to_sheet(data, { header: headers });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 2, 18) }));

  const fileName = `${kind}-${dateStamp()}.${format}`;

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // The BOM keeps Excel from mangling non-ASCII names.
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), fileName);
    return fileName;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, definition.plural);
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
  return fileName;
}

/** Downloads a template (headers + one sample row) as .xlsx or .csv. */
export async function downloadMasterDataTemplate(
  kind: MasterDataKind,
  format: SpreadsheetFormat = "xlsx"
): Promise<string> {
  const definition = MASTER_DATA[kind];
  const XLSX = await loadXlsx();

  const headers = definition.fields.map((field) => field.label);
  const sample: Record<string, string> = {};
  for (const field of definition.fields) sample[field.label] = field.sample;

  const sheet = XLSX.utils.json_to_sheet([sample], { header: headers });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 2, 18) }));

  const fileName = `${definition.templateFileName}-${dateStamp()}.${format}`;

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // The BOM keeps Excel from mangling non-ASCII names.
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), fileName);
    return fileName;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, definition.plural);
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
  return fileName;
}
