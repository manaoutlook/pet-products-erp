import { useState } from "react";
import {
  ATTACHMENT_ENTITY_LABELS,
  ATTACHMENT_HELP_TEXT,
  type AttachmentEntityType,
} from "@shared/attachments";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Paperclip } from "lucide-react";
import { AttachmentUploader } from "./AttachmentUploader";

/**
 * "Proof pictures" on a row that already exists: a paperclip button that opens the transaction's
 * documents. Used by the purchase-order, customer-receipt and finance-entry registers; the upload
 * itself is the shared `AttachmentUploader`.
 */
export function AttachmentsButton({
  entityType,
  entityId,
  label,
  title,
  className,
}: {
  entityType: AttachmentEntityType;
  entityId: number;
  /** Row-specific name shown in the dialog heading (e.g. the order number). */
  label?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const heading = label ?? ATTACHMENT_ENTITY_LABELS[entityType];

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className}
        onClick={() => setOpen(true)}
        title={title ?? "Receipts, bank-transfer screenshots and related documents"}
      >
        <Paperclip className="h-4 w-4" />
        <span className="sr-only">Pictures for {heading}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pictures - {heading}</DialogTitle>
            <DialogDescription>{ATTACHMENT_HELP_TEXT}</DialogDescription>
          </DialogHeader>

          <AttachmentUploader entityType={entityType} entityId={entityId} />
        </DialogContent>
      </Dialog>
    </>
  );
}
