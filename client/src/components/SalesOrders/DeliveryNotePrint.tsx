import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatQuantity } from "@/utils/format";
import { BRAND_NAME, BRAND_WEBSITE } from "@/config/branding";
import { buildPrintDocument, escapeHtml, openPrintDocument, printValue } from "@/utils/print-document";
import {
  buildDocumentCompanyHeader,
  companyHeaderMissingFields,
  DocumentHeaderNotice,
} from "@/components/company/CompanyHeader";
import { companyHeaderProblemMessage, type CompanyHeader } from "@shared/company";

/** One line on the note: ordered vs delivered snapshots taken when the note was issued. */
export interface DeliveryNotePrintLine {
  productCode: string;
  description: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  remarks?: string | null;
}

export interface DeliveryNotePrintData {
  deliveryNoteNumber: string;
  deliveryDate?: string | Date | null;
  customerName: string;
  companyName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  customerConfirmed?: boolean | null;
  remarks?: string | null;
  /** The order the goods belong to - printed as "Related Order No". */
  salesOrder?: { orderNumber: string } | null;
  deliveredByUser?: { username: string } | null;
  items?: DeliveryNotePrintLine[] | null;
}

/**
 * Build the A4 delivery note (PDF page 2).
 *
 * Ordered and delivered quantities come from the note's own snapshot columns, so a reprint
 * still says "Ordered 10 / Delivered 6" after the balance of the order has shipped.
 *
 * `company` is the letterhead from `useCompanyInfo()`; an incomplete one throws
 * `CompanyHeaderError` rather than printing a header with blanks in it.
 */
export function buildDeliveryNotePrintDocument(
  note: DeliveryNotePrintData,
  company: CompanyHeader | null | undefined
): string {
  const items = note.items ?? [];

  const rows = items
    .map(
      (line, index) => `
        <tr>
          <td class="center">${index + 1}</td>
          <td>${printValue(line.productCode)}</td>
          <td>${printValue(line.description)}</td>
          <td class="num">${escapeHtml(formatQuantity(line.orderedQuantity))}</td>
          <td class="num">${escapeHtml(formatQuantity(line.deliveredQuantity))}</td>
          <td>${printValue(line.remarks)}</td>
        </tr>`
    )
    .join('');

  const body = `
    ${buildDocumentCompanyHeader(company)}

    <div class="header">
      <h1>DELIVERY NOTE</h1>
      <div class="meta">
        <div><span class="label">Delivery Note No:</span> ${printValue(note.deliveryNoteNumber)}</div>
        <div><span class="label">Related Order No:</span> ${printValue(note.salesOrder?.orderNumber)}</div>
        <div><span class="label">Delivery Date:</span> ${printValue(formatDate(note.deliveryDate))}</div>
      </div>
    </div>

    <div class="section-title">Customer Information</div>
    <div class="grid">
      <div><span class="label">Customer Name:</span> ${printValue(note.customerName)}</div>
      <div><span class="label">Company Name:</span> ${printValue(note.companyName)}</div>
      <div><span class="label">Contact Person:</span> ${printValue(note.contactPerson)}</div>
      <div><span class="label">Phone:</span> ${printValue(note.phone)}</div>
      <div class="wide"><span class="label">Delivery Address:</span> ${printValue(note.deliveryAddress)}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="center" style="width: 34px;">No</th>
          <th style="width: 110px;">Product Code</th>
          <th>Product Description</th>
          <th class="num" style="width: 70px;">Ordered Qty</th>
          <th class="num" style="width: 80px;">Delivered Qty</th>
          <th style="width: 150px;">Remarks</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6">&nbsp;</td></tr>'}</tbody>
    </table>

    <div class="confirmation">
      <span class="box${note.customerConfirmed ? ' checked' : ''}"></span>
      <span class="label">Customer Confirmation:</span> Goods received in good condition.
      ${note.remarks ? `<div class="notes" style="margin-top: 8px;">${printValue(note.remarks)}</div>` : ''}
    </div>

    <div class="signatures">
      <div class="signature">
        <div class="role">Delivered By (SL)</div>
        <div class="hint">Signature:</div>
        <div class="line">&nbsp;</div>
      </div>
      <div class="signature">
        <div class="role">Received By (Customer)</div>
        <div class="hint">Signature &amp; Chop:</div>
        <div class="line">&nbsp;</div>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(BRAND_NAME)} &middot; ${escapeHtml(BRAND_WEBSITE)} &middot; Delivered by
      ${printValue(note.deliveredByUser?.username)}
    </div>`;

  return buildPrintDocument(`Delivery Note ${note.deliveryNoteNumber}`, body);
}

/** Print the note, reporting a blocked pop-up instead of failing silently. */
export function printDeliveryNote(
  note: DeliveryNotePrintData,
  company: CompanyHeader | null | undefined
): boolean {
  return openPrintDocument(buildDeliveryNotePrintDocument(note, company));
}

interface DeliveryNotePrintDialogProps {
  note: DeliveryNotePrintData;
  /** The letterhead from `useCompanyInfo()` - the same one the screen header shows. */
  company: CompanyHeader | null | undefined;
  children: ReactNode;
}

/**
 * A4 preview + print button, previewing the exact document that will be printed.
 *
 * An incomplete letterhead replaces the preview with the notice and disables Print, using
 * the same rule and the same message as the screen header.
 */
export function DeliveryNotePrintDialog({ note, company, children }: DeliveryNotePrintDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const missingFields = companyHeaderMissingFields(company);
  const isPrintable = missingFields.length === 0;
  const documentHtml = isPrintable ? buildDeliveryNotePrintDocument(note, company) : null;

  const handlePrint = () => {
    if (!isPrintable) {
      toast({
        title: "Company letterhead incomplete",
        description: companyHeaderProblemMessage(missingFields),
        variant: "destructive",
      });
      return;
    }

    if (!printDeliveryNote(note, company)) {
      toast({
        title: "Print Blocked",
        description: "Allow pop-ups for this site to print the delivery note",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delivery Note - {note.deliveryNoteNumber}</DialogTitle>
          <DialogDescription>
            A4 preview. The customer signs the printed copy on arrival.
          </DialogDescription>
        </DialogHeader>
        {documentHtml ? (
          <iframe
            title={`Delivery note ${note.deliveryNoteNumber}`}
            srcDoc={documentHtml}
            className="h-[70vh] w-full rounded-md border bg-white"
          />
        ) : (
          <DocumentHeaderNotice missingFields={missingFields} />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={handlePrint} disabled={!isPrintable}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DeliveryNotePrintDialog;
