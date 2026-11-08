import type * as XLSXType from "xlsx";

/**
 * Helpers behind the Products page **Export** and **Import** buttons.
 *
 * - `exportProducts` writes the visible product list to .xlsx or .csv.
 * - `readSpreadsheetFile` reads a .csv/.xlsx/.xls file and maps its headers onto
 *   the canonical product import fields that `POST /api/products/import` expects.
 *
 * SheetJS is loaded lazily (dynamic import) so the parser is only downloaded
 * when the user actually exports or imports.
 */

const loadXlsx = (): Promise<typeof XLSXType> => import("xlsx");

export type ProductImportFieldKey =
  | "name"
  | "sku"
  | "description"
  | "category"
  | "brand"
  | "supplier"
  | "landingPrice"
  | "b2bPrice"
  | "b2cPrice"
  | "minStock"
  | "weightKg"
  | "lengthCm"
  | "widthCm"
  | "heightCm";

interface ImportFieldDefinition {
  key: ProductImportFieldKey;
  label: string;
  /**
   * Accepted header spellings, most specific first. The first alias that is
   * present in the file wins, so "B2C Price" beats the generic "Price".
   */
  aliases: string[];
  required?: boolean;
}

export const PRODUCT_IMPORT_FIELDS: ImportFieldDefinition[] = [
  { key: "name", label: "Name", aliases: ["name", "productname", "product", "itemname", "title"], required: true },
  { key: "sku", label: "SKU", aliases: ["sku", "skucode", "productcode", "itemcode", "code"], required: true },
  { key: "description", label: "Description", aliases: ["description", "productdescription", "details", "desc"] },
  { key: "category", label: "Category", aliases: ["category", "categoryname", "productcategory"], required: true },
  { key: "brand", label: "Brand", aliases: ["brand", "brandname"] },
  { key: "supplier", label: "Supplier", aliases: ["supplier", "suppliername", "vendor", "vendorname"], required: true },
  { key: "landingPrice", label: "Landing Price", aliases: ["landingprice", "landing", "costprice", "cost", "purchaseprice"] },
  { key: "b2bPrice", label: "B2B Price", aliases: ["b2bprice", "b2b", "wholesaleprice", "wholesale"] },
  { key: "b2cPrice", label: "B2C Price", aliases: ["b2cprice", "b2c", "retailprice", "retail", "sellingprice", "saleprice", "price"], required: true },
  { key: "minStock", label: "Min Stock", aliases: ["minstock", "minstocklevel", "minimumstock", "reorderlevel", "reorderpoint", "minlevel"] },
  { key: "weightKg", label: "Weight (kg)", aliases: ["weightkg", "weightkgs", "weightkilogram", "weightkilograms", "weight", "grossweight", "itemweight"] },
  { key: "lengthCm", label: "Length (cm)", aliases: ["lengthcm", "length", "itemlength"] },
  { key: "widthCm", label: "Width (cm)", aliases: ["widthcm", "width", "itemwidth"] },
  { key: "heightCm", label: "Height (cm)", aliases: ["heightcm", "height", "itemheight"] },
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
  fields: Partial<Record<ProductImportFieldKey, number>>;
  unmatched: string[];
  missingRequired: string[];
} {
  const normalized = headers.map((header) => normalizeHeader(String(header ?? "")));
  const fields: Partial<Record<ProductImportFieldKey, number>> = {};
  const usedColumns = new Set<number>();

  for (const definition of PRODUCT_IMPORT_FIELDS) {
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
  const missingRequired = PRODUCT_IMPORT_FIELDS.filter(
    (definition) => definition.required && fields[definition.key] === undefined
  ).map((definition) => definition.label);

  return { fields, unmatched, missingRequired };
}

export interface ParsedSpreadsheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  /** Canonical-field rows, ready to be posted to /api/products/import */
  rows: Record<string, unknown>[];
  /** Human readable preview (first rows, original cell values) */
  preview: Record<ProductImportFieldKey, unknown>[];
  unmatchedHeaders: string[];
  missingRequiredHeaders: string[];
}

const PREVIEW_ROWS = 8;

export async function readSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
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
  const preview: Record<ProductImportFieldKey, unknown>[] = [];

  for (const rawRow of matrix.slice(1) as unknown[][]) {
    const cells = Array.isArray(rawRow) ? rawRow : [];
    if (!cells.some((cell) => !isBlankCell(cell))) continue;

    const row: Record<string, unknown> = {};
    const previewRow = {} as Record<ProductImportFieldKey, unknown>;

    for (const definition of PRODUCT_IMPORT_FIELDS) {
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

/** Minimal shape of a product row returned by `GET /api/products`. */
export interface ExportableProduct {
  name: string;
  sku: string;
  description?: string | null;
  price?: string | number | null;
  landingPrice?: string | number | null;
  b2bPrice?: string | number | null;
  b2cPrice?: string | number | null;
  minStock?: number | null;
  weightKg?: string | number | null;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
  category?: { name: string } | null;
  brand?: { name: string } | null;
  supplier?: { name: string } | null;
  inventory?: { quantity: number }[];
}

const toNumberOrBlank = (value: string | number | null | undefined): number | "" => {
  if (value === null || value === undefined || value === "") return "";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : "";
};

const stockOf = (product: ExportableProduct): number =>
  product.inventory?.[0]?.quantity ?? 0;

/** Column order of the export file - also the column order of the template. */
export const EXPORT_COLUMNS: {
  header: string;
  value: (product: ExportableProduct) => string | number;
}[] = [
  { header: "Name", value: (product) => product.name },
  { header: "SKU", value: (product) => product.sku },
  { header: "Description", value: (product) => product.description ?? "" },
  { header: "Category", value: (product) => product.category?.name ?? "" },
  { header: "Brand", value: (product) => product.brand?.name ?? "" },
  { header: "Supplier", value: (product) => product.supplier?.name ?? "" },
  { header: "Landing Price", value: (product) => toNumberOrBlank(product.landingPrice) },
  { header: "B2B Price", value: (product) => toNumberOrBlank(product.b2bPrice) },
  { header: "B2C Price", value: (product) => toNumberOrBlank(product.b2cPrice ?? product.price) },
  { header: "Min Stock", value: (product) => product.minStock ?? 0 },
  { header: "Weight (kg)", value: (product) => toNumberOrBlank(product.weightKg) },
  { header: "Length (cm)", value: (product) => toNumberOrBlank(product.lengthCm) },
  { header: "Width (cm)", value: (product) => toNumberOrBlank(product.widthCm) },
  { header: "Height (cm)", value: (product) => toNumberOrBlank(product.heightCm) },
  { header: "Current Stock", value: (product) => stockOf(product) },
  {
    header: "Status",
    value: (product) => {
      const stock = stockOf(product);
      if (stock <= 0) return "Out of Stock";
      if (stock <= (product.minStock ?? 0)) return "Low Stock";
      return "In Stock";
    },
  },
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

export type ExportFormat = "xlsx" | "csv";

/**
 * Writes the given products to a downloadable .xlsx/.csv file and returns the
 * file name (useful for toasts/tests).
 */
export async function exportProducts(
  products: ExportableProduct[],
  format: ExportFormat
): Promise<string> {
  const XLSX = await loadXlsx();

  const data = products.map((product) => {
    const row: Record<string, string | number> = {};
    for (const column of EXPORT_COLUMNS) {
      row[column.header] = column.value(product);
    }
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(data, {
    header: EXPORT_COLUMNS.map((column) => column.header),
  });
  sheet["!cols"] = EXPORT_COLUMNS.map((column) => ({ wch: Math.max(column.header.length + 2, 14) }));

  const fileName = `products-${dateStamp()}.${format}`;

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // The BOM keeps Excel from mangling non-ASCII (e.g. Vietnamese) names.
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), fileName);
    return fileName;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
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
    Name: "Sample Ballpoint Pen",
    SKU: "SAMPLE-001",
    Description: "Blue ink, 1.0mm tip",
    Category: "Ballpoint Pens",
    Brand: "SmartLife",
    Supplier: "Acme Trading",
    "Landing Price": 18000,
    "B2B Price": 24000,
    "B2C Price": 32000,
    "Min Stock": 10,
    "Weight (kg)": 0.012,
    "Length (cm)": 14,
    "Width (cm)": 1,
    "Height (cm)": 1,
  };

  // The template columns mirror exactly the importable fields (the same list the
  // importer parses headers against), so every header it understands - including
  // weight/dimensions - is always present in the downloaded file.
  const headers = PRODUCT_IMPORT_FIELDS.map((field) => field.label);
  const sheet = XLSX.utils.json_to_sheet([sample], { header: headers });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 2, 14) }));

  const fileName = `product-import-template.${format}`;

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // The BOM keeps Excel from mangling non-ASCII (e.g. Vietnamese) names.
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), fileName);
    return fileName;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
  return fileName;
}
