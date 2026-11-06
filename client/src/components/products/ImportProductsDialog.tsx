import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  downloadImportTemplate,
  readSpreadsheetFile,
  type ParsedSpreadsheet,
} from "@/utils/product-spreadsheet";

export interface ImportProductsResult {
  message: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  createdCategories: number;
  createdBrands: number;
  createdSuppliers: number;
  errors: { row: number; sku?: string; name?: string; message: string }[];
}

interface ImportProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful import so the product list can be refetched. */
  onImported?: () => void;
}

const ACCEPTED_EXTENSIONS = ".csv,.xlsx,.xls";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB - matches the API body limit

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

export function ImportProductsDialog({
  open,
  onOpenChange,
  onImported,
}: ImportProductsDialogProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState<ImportProductsResult | null>(null);

  const reset = () => {
    setParsed(null);
    setError(null);
    setResult(null);
    setIsReading(false);
    setIsImporting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Starting a new import session every time the dialog opens keeps stale
  // summaries from a previous attempt out of the way.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setResult(null);
    setError(null);

    if (file.size > MAX_FILE_SIZE) {
      setParsed(null);
      setError(
        "The file is larger than 10 MB. Split it into smaller files and import them one at a time."
      );
      return;
    }

    setIsReading(true);
    try {
      const parsedFile = await readSpreadsheetFile(file);
      if (parsedFile.rows.length === 0) {
        setParsed(null);
        setError("No product rows were found in the file (header row only?).");
        return;
      }
      setParsed(parsedFile);
    } catch (parseError) {
      setParsed(null);
      setError(parseError instanceof Error ? parseError.message : "The file could not be read.");
    } finally {
      setIsReading(false);
    }
  };

  const handleImport = async () => {
    if (!parsed) return;

    setIsImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows: parsed.rows, updateExisting, createMissing: true }),
      });

      if (!response.ok) {
        let message = "Failed to import products";
        try {
          const body = await response.json();
          if (body?.message) message = body.message;
          if (Array.isArray(body?.errors) && body.errors.length > 0) {
            message = `${message}: ${body.errors
              .map((item: { message?: string }) => item?.message ?? "")
              .filter(Boolean)
              .join(", ")}`;
          }
        } catch {
          const text = await response.text().catch(() => "");
          if (text) message = text;
        }
        throw new Error(message);
      }

      const summary = (await response.json()) as ImportProductsResult;
      setResult(summary);
      onImported?.();
      toast({ title: "Import finished", description: summary.message });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import products");
    } finally {
      setIsImporting(false);
    }
  };

  const handleTemplate = async (format: "xlsx" | "csv") => {
    try {
      const fileName = await downloadImportTemplate(format);
      toast({ title: "Template downloaded", description: fileName });
    } catch {
      toast({
        title: "Error",
        description: "The template could not be generated",
        variant: "destructive",
      });
    }
  };

  const rowCount = parsed?.rows.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (isImporting ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Products</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file (.csv, .xlsx, .xls). Products are matched by SKU, so
            existing products are updated instead of duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!result && (
            <>
              <div className="space-y-3 rounded-md border border-dashed p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4" />
                  Spreadsheet file
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  aria-label="Product spreadsheet file"
                  className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
                  onChange={(event) => handleFile(event.target.files?.[0])}
                  disabled={isReading || isImporting}
                />
                <p className="text-xs text-muted-foreground">
                  Required columns: Name, SKU, Category, Supplier, B2C Price. Optional:
                  Description, Brand, Landing Price, B2B Price, Min Stock.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Download a blank template:</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTemplate("csv")}
                    disabled={isImporting}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    CSV format
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTemplate("xlsx")}
                    disabled={isImporting}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Excel format
                  </Button>
                </div>
              </div>

              {isReading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading file...
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {parsed && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {parsed.fileName} · sheet “{parsed.sheetName}”
                    </span>
                    <span className="text-muted-foreground">
                      {rowCount} product{rowCount === 1 ? "" : "s"} found
                    </span>
                  </div>

                  {parsed.unmatchedHeaders.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Ignored columns: {parsed.unmatchedHeaders.join(", ")}
                    </p>
                  )}

                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>B2C Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.preview.map((row, index) => (
                          <TableRow key={index}>
                            <TableCell className="max-w-[16rem] truncate">
                              {cellText(row.name) || <span className="text-destructive">—</span>}
                            </TableCell>
                            <TableCell>{cellText(row.sku)}</TableCell>
                            <TableCell>{cellText(row.category)}</TableCell>
                            <TableCell>{cellText(row.supplier)}</TableCell>
                            <TableCell>{cellText(row.b2cPrice)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {rowCount > parsed.preview.length && (
                    <p className="text-xs text-muted-foreground">
                      Showing the first {parsed.preview.length} rows.
                    </p>
                  )}

                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={updateExisting}
                      onCheckedChange={(checked) => setUpdateExisting(checked === true)}
                      disabled={isImporting}
                    />
                    Update products that already exist (same SKU)
                  </label>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{result.message}</p>
                  <p className="mt-1 text-xs">
                    {result.created} created · {result.updated} updated · {result.skipped} skipped
                    {result.createdCategories + result.createdBrands + result.createdSuppliers > 0
                      ? ` · new master data: ${result.createdCategories} categories, ${result.createdBrands} brands, ${result.createdSuppliers} suppliers`
                      : ""}
                  </p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {result.errors.length} row{result.errors.length === 1 ? "" : "s"} could not be imported
                  </p>
                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    <ul className="divide-y text-sm">
                      {result.errors.map((rowError, index) => (
                        <li key={index} className="flex gap-2 p-2">
                          <span className="w-16 shrink-0 text-xs text-muted-foreground">
                            Row {rowError.row}
                          </span>
                          <span>
                            {rowError.sku ? <span className="font-medium">{rowError.sku}: </span> : null}
                            {rowError.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {result ? (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                Import another file
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isImporting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleImport} disabled={!parsed || isImporting || isReading}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Import{rowCount > 0 ? ` ${rowCount} product${rowCount === 1 ? "" : "s"}` : ""}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportProductsDialog;
