import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Landmark, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { formatPercent } from "@/utils/format";
import { VAT_COMPANY_SEEDS } from "@shared/invoice";
import { VAT_RATE, percentToRate, rateToPercent, toVatRate } from "@shared/tax";
import { VAT_COMPANIES_QUERY_KEY, useVatCompanies, type VatCompany } from "@/hooks/use-vat-companies";

/**
 * VAT Companies - the two legal entities a VAT invoice may be issued under.
 *
 * AI Agent Note: `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH` is a household business and is NOT allowed
 * to issue a VAT invoice. When a customer asks for one, the sale is invoiced under one of these
 * companies and the printed invoice shows THIS name, THIS tax code and THIS address - not the
 * household letterhead. Each company keeps its own invoice number sequence (`CI-...` / `HI-...`),
 * so the two tax books never share a counter.
 *
 * The tax code and address are what make a VAT invoice valid, so a company with a blank field is
 * listed as incomplete and cannot be chosen at the till (the server refuses it too).
 *
 * The VAT rate on this screen is the percentage EVERY invoice that company issues charges. The
 * form edits it as a percentage ("8.5") while the database stores a fraction (0.085, the same
 * unit as `sales_transactions.vat_rate`) - `percentToRate` / `rateToPercent` do that conversion.
 */

interface FormValues {
  code: string;
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  bankAccount: string;
  /** Percentage as typed in the form ("8.5"); converted to a fraction when saved. */
  vatRate: string;
  isActive: boolean;
}

const EMPTY_FORM: FormValues = {
  code: "",
  name: "",
  taxId: "",
  address: "",
  phone: "",
  email: "",
  bankAccount: "",
  vatRate: String(rateToPercent(VAT_RATE)),
  isActive: true,
};

/**
 * AI Agent Note: the code is NOT a free-form label - it is the prefix of every invoice number the
 * company will ever issue (`CI` -> `CI-20261109-0001`), which is why it is 2-10 letters/digits and
 * cannot be edited later. Validating it here, before the request, means the cashier sees the
 * problem next to the field instead of getting an "Invalid request" toast from the server.
 */
const CODE_PATTERN = /^[A-Z0-9]{2,10}$/;
const RESERVED_CODES = VAT_COMPANY_SEEDS.map((seed) => seed.code);

function codeError(rawCode: string): string | null {
  const code = rawCode.trim().toUpperCase();
  if (!code) return "Code is required";
  if (!CODE_PATTERN.test(code)) return "Use 2-10 letters or digits only, with no dashes (e.g. CI, HI)";
  if (RESERVED_CODES.some((reserved) => reserved === code)) {
    return `${code} already exists - edit ${code} in the list to fill in its tax code and address`;
  }
  return null;
}

function toForm(company: VatCompany): FormValues {
  return {
    code: company.code,
    name: company.name,
    taxId: company.taxId ?? "",
    address: company.address ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    bankAccount: company.bankAccount ?? "",
    // The API returns the stored fraction (0.085); the field shows "8.5".
    vatRate: String(rateToPercent(toVatRate(company.vatRate))),
    isActive: company.isActive,
  };
}

/**
 * Validate the VAT % field.
 *
 * AI Agent Note: the operator types a PERCENTAGE here ("10", "8.5"), but the API stores the
 * fraction (0.1, 0.085). Validating the percentage before the request means a typo shows up next
 * to the field instead of as a server "Invalid request" toast. `percentToRate` does the
 * conversion on save; `rateToPercent` fills the field when a company is opened for editing.
 */
const VAT_PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

function vatRateError(rawValue: string): string | null {
  const value = rawValue.trim().replace(",", ".");
  if (!value) return "VAT % is required";
  if (!VAT_PERCENT_PATTERN.test(value)) {
    return "Use a number with up to 2 decimals, e.g. 10 or 8.5";
  }
  if (Number(value) > 100) return "VAT % must be between 0 and 100";
  return null;
}

function VatCompaniesPage() {
  const { companies, isLoading, isError, error, refetch } = useVatCompanies();
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<VatCompany | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);

  const canCreate = hasPermission("masterData", "create");
  const canUpdate = hasPermission("masterData", "update");

  const openCreate = () => {
    setEditing(null);
    setValues(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (company: VatCompany) => {
    setEditing(company);
    setValues(toForm(company));
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: FormValues) => {
      const creating = !editing;
      const company = {
        name: payload.name,
        taxId: payload.taxId,
        address: payload.address,
        phone: payload.phone || null,
        email: payload.email || null,
        bankAccount: payload.bankAccount || null,
        // The field holds a percentage ("8.5"); the API and the database hold the fraction
        // (0.085), the same unit the invoice arithmetic uses.
        vatRate: percentToRate(Number(payload.vatRate.trim().replace(",", "."))),
        isActive: payload.isActive,
      };

      const response = await fetch(
        creating ? "/api/vat-companies" : `/api/vat-companies/${editing!.id}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(creating ? { code: payload.code, ...company } : company),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save the VAT company");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VAT_COMPANIES_QUERY_KEY });
      setFormOpen(false);
      toast({
        title: editing ? "VAT company saved" : "VAT company created",
        description: editing
          ? "Invoices issued from now on print the new details"
          : "Its own invoice number sequence has been created",
        variant: "success",
      });
    },
    onError: (mutationError: Error) => {
      toast({
        title: "Save failed",
        description: mutationError.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    // The code is created once and then locked, so it is validated (and shown) here rather than
    // letting the request fail with a server-side "Invalid request" toast.
    if (!editing) {
      const error = codeError(values.code);
      if (error) {
        toast({ title: "Check the code", description: error, variant: "destructive" });
        return;
      }
    }
    if (!values.name.trim()) {
      toast({ title: "Company name is required", variant: "destructive" });
      return;
    }
    const rateProblem = vatRateError(values.vatRate);
    if (rateProblem) {
      toast({ title: "Check the VAT %", description: rateProblem, variant: "destructive" });
      return;
    }
    saveMutation.mutate(values);
  };

  const codeValidationError = editing ? null : codeError(values.code);
  const vatRateValidationError = vatRateError(values.vatRate);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Landmark className="h-6 w-6" />
            VAT Companies
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            The companies a VAT invoice may be issued under. The household business cannot issue
            a VAT invoice, so when a customer asks for one the sale is invoiced by one of these
            companies, with its own name, tax code, address, VAT rate and invoice number sequence.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add company
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice issuers</CardTitle>
          <CardDescription>
            A company with a blank tax code or address cannot issue a VAT invoice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading companies...
            </div>
          ) : isError ? (
            <div className="py-8 space-y-2 text-center">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {(error as Error)?.message || "Failed to load VAT companies"}
              </div>
              <p className="text-xs text-muted-foreground max-w-xl mx-auto">
                If this says the table is missing, the database has not been updated yet: run{" "}
                <span className="font-mono">npm run db:push</span> (or apply{" "}
                <span className="font-mono">migrations/0022_vat_invoices_immutable.sql</span>), then
                press Refresh.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          ) : companies.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No VAT company configured yet.
            </p>
          ) : (
            <Table className="table-actions-sticky min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Code</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Tax code</TableHead>
                  <TableHead className="w-[90px]">VAT %</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="w-[150px]">Status</TableHead>
                  <TableHead className="text-right w-[110px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-mono font-medium">{company.code}</TableCell>
                    <TableCell>{company.name}</TableCell>
                    <TableCell>
                      {company.taxId || <span className="text-destructive">missing</span>}
                    </TableCell>
                    <TableCell className="font-medium">{formatPercent(company.vatRate)}</TableCell>
                    <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                      {company.address || <span className="text-destructive">missing</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={company.isActive ? "default" : "secondary"}>
                          {company.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {company.missingFields.length > 0 && (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {company.missingFields.join(", ")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {canUpdate && (
                        <Button variant="outline" size="sm" onClick={() => openEdit(company)}>
                          <Pencil className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        {/*
          AI Agent Note: the form is taller than a laptop viewport (7 fields + helper text), so the
          dialog is capped to 90vh and its body scrolls. Without this the footer buttons and the
          close (X) button were pushed off-screen and could not be reached.
        */}
        <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
            <DialogTitle>{editing ? `Edit ${editing.code}` : "Add VAT company"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "These details are printed as the seller on every VAT invoice this company issues, and its VAT % is charged on them."
                : "CI and HI already exist - open them in the list to fill in their tax code, address and VAT rate. Use this only for a further licensed company."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="vat-code">Code (invoice prefix)</Label>
                <Input
                  id="vat-code"
                  value={values.code}
                  disabled={Boolean(editing)}
                  maxLength={10}
                  className={codeValidationError && values.code ? "border-destructive" : undefined}
                  onChange={(event) =>
                    // Strip anything that cannot appear in an invoice number as the user types:
                    // the code is the prefix of CI-20261109-0001, never a template or a word.
                    setValues((prev) => ({
                      ...prev,
                      code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    }))
                  }
                  placeholder="CI"
                />
                {codeValidationError && values.code ? (
                  <p className="text-xs text-destructive mt-1">{codeValidationError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    2-10 letters or digits, e.g. <span className="font-mono">CI</span> becomes{" "}
                    <span className="font-mono">CI-20261109-0001</span>. Cannot be changed later - it
                    is part of every invoice number already issued.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="vat-name">Company name</Label>
                <Input
                  id="vat-name"
                  value={values.name}
                  onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="vat-tax-id">Tax code</Label>
                <Input
                  id="vat-tax-id"
                  value={values.taxId}
                  onChange={(event) => setValues((prev) => ({ ...prev, taxId: event.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="vat-rate">VAT %</Label>
                <Input
                  id="vat-rate"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max="100"
                  value={values.vatRate}
                  className={vatRateValidationError ? "border-destructive" : undefined}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, vatRate: event.target.value }))
                  }
                  placeholder="10"
                />
                {vatRateValidationError ? (
                  <p className="text-xs text-destructive mt-1">{vatRateValidationError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Charged on every VAT invoice this company issues. Entered as a percentage - 10
                    means 10%.
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="vat-bank">Bank account</Label>
                <Input
                  id="vat-bank"
                  value={values.bankAccount}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, bankAccount: event.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="vat-address">Address</Label>
                <Textarea
                  id="vat-address"
                  value={values.address}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, address: event.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                <div>
                  <Label htmlFor="vat-phone">Phone</Label>
                  <Input
                    id="vat-phone"
                    value={values.phone}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, phone: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="vat-email">Email</Label>
                  <Input
                    id="vat-email"
                    value={values.email}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, email: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  id="vat-active"
                  checked={values.isActive}
                  onCheckedChange={(checked) =>
                    setValues((prev) => ({ ...prev, isActive: checked }))
                  }
                />
                <Label htmlFor="vat-active">Active (can issue new VAT invoices)</Label>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                saveMutation.isPending ||
                Boolean(codeValidationError) ||
                Boolean(vatRateValidationError)
              }
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default VatCompaniesPage;
