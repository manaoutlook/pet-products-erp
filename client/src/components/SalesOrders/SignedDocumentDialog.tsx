import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/format";
import { uploadImageFile } from "@/utils/product-image-upload";

/** The bits of a delivery note this dialog needs - the page row is a superset. */
export interface SignedDocumentNote {
  id: number;
  deliveryNoteNumber: string;
  signedDocumentUrl?: string | null;
  signedDocumentUploadedAt?: string | null;
}

interface SignedDocumentDialogProps {
  note: SignedDocumentNote;
  /** `orders:update` - only someone allowed to issue notes may file the signed copy. */
  canUpdate: boolean;
  children: ReactNode;
}

/**
 * File the picture of the note the customer signed, or look at the one already on file.
 *
 * The paper trail ends here: the note is printed unsigned (see DeliveryNoteFormDialog), the
 * customer signs it on arrival, and the office photographs or scans it back in. The upload is
 * compressed in the browser and posted to POST /api/delivery-notes/:id/signed-document, which
 * ticks `customerConfirmed` and flips the row from "Awaiting signature" to "Signed/Completed".
 *
 * Re-uploading replaces the picture - a blurry first photo is the common case, and refusing a
 * second attempt would leave the note permanently half-recorded.
 */
export function SignedDocumentDialog({ note, canUpdate, children }: SignedDocumentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const existingUrl = note.signedDocumentUrl ?? null;

  // An object URL pins the picked bytes in memory, so release it whenever the choice changes.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const upload = useMutation({
    mutationFn: (picked: File) =>
      uploadImageFile(picked, `/api/delivery-notes/${note.id}/signed-document`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/delivery-notes"] });
      toast({
        title: "Signed document saved",
        description: `${note.deliveryNoteNumber} is signed off - the note is complete.`,
        variant: "success",
      });
      setFile(null);
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Picture not uploaded",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    setFile(picked);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setFile(null);
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signed delivery note - {note.deliveryNoteNumber}</DialogTitle>
          <DialogDescription>
            {existingUrl
              ? "The picture filed for this delivery. Replacing it overwrites the previous one."
              : "Photograph or scan the sheet the customer signed. Uploading it marks this note Signed/Completed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {preview ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">New picture - not filed yet</p>
              <img
                src={preview}
                alt={`Signed ${note.deliveryNoteNumber} to upload`}
                className="max-h-[50vh] w-full rounded-md border bg-muted object-contain"
              />
            </div>
          ) : existingUrl ? (
            <div className="space-y-1">
              <img
                src={existingUrl}
                alt={`Signed ${note.deliveryNoteNumber}`}
                className="max-h-[50vh] w-full rounded-md border bg-muted object-contain"
              />
              {note.signedDocumentUploadedAt && (
                <p className="text-caption text-muted-foreground">
                  Filed {formatDate(note.signedDocumentUploadedAt)}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No signed copy on file yet. Pick the photo of the signed sheet to complete this note.
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Upload signed delivery note"
            onChange={handlePicked}
            disabled={!canUpdate || upload.isPending}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canUpdate || upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {file || existingUrl ? "Choose another picture" : "Choose picture"}
            </Button>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              {canUpdate && (
                <Button
                  type="button"
                  variant="create"
                  disabled={!file || upload.isPending}
                  onClick={() => file && upload.mutate(file)}
                >
                  {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save signed document
                </Button>
              )}
            </div>
          </div>

          {!canUpdate && (
            <p className="text-sm text-muted-foreground">
              You can view the signed document but not file it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SignedDocumentDialog;
