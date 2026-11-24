import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HELP_TEXT,
  MAX_ATTACHMENTS_PER_ENTITY,
  attachmentFileError,
  type AttachmentEntityType,
} from "@shared/attachments";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ClipboardPaste, ImagePlus, Loader2, X } from "lucide-react";
import { deleteAttachment, listAttachments, uploadAttachment } from "./attachment-api";
import { readClipboardImages, usePasteImages } from "./use-paste-images";

/**
 * Under every picker. Screenshots are the normal case for a bank transfer, and they are already on
 * the clipboard - saving one to disk first and then hunting for it in the file dialog is exactly
 * the step where people give up.
 */
const PASTE_HINT =
  "Or copy a screenshot and press ⌘V (Ctrl+V) here - or use “Paste screenshot”.";

/**
 * The picture field on a transaction.
 *
 * Two versions, because a transaction has two lives:
 *
 *   `AttachmentUploader`      - the record already exists (opened from a register row). Pictures
 *                               are uploaded one by one, and each can be removed again.
 *   `PendingAttachmentPicker` - the record is being created and has no id yet. The files are only
 *                               held in memory; the caller uploads them once the POST returns the
 *                               new id (`uploadAttachmentFiles`).
 *
 * Both show the same tiles, the same cap and the same per-file validation, so the limit a user
 * meets while creating a receipt is the one the API enforces later.
 *
 * AI Agent Note - a picture can arrive two ways and both end in the same handler: chosen with the
 * file dialog (`<input type="file">`), or pasted with Cmd+V / Ctrl+V (`usePasteImages`, which is
 * how a bank-transfer screenshot normally reaches the screen). Adding a third source means calling
 * the same `handleFiles`/`addFiles` with more `File`s - never a second copy of the cap check.
 */

interface AttachmentTile {
  key: string;
  url: string;
  name: string;
}

function AttachmentTiles({
  tiles,
  onRemove,
  removing,
}: {
  tiles: AttachmentTile[];
  onRemove?: (key: string) => void;
  removing?: boolean;
}) {
  if (tiles.length === 0) {
    return <p className="text-xs text-muted-foreground">No pictures attached yet.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="group relative overflow-hidden rounded-md border border-border bg-muted"
        >
          <a
            href={tile.url}
            target="_blank"
            rel="noreferrer"
            title={tile.name}
            className="block aspect-square"
          >
            <img src={tile.url} alt={tile.name} className="h-full w-full object-cover" />
          </a>
          {onRemove ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute right-1 top-1 h-6 w-6"
              onClick={() => onRemove(tile.key)}
              disabled={removing}
              title={`Remove ${tile.name}`}
              aria-label={`Remove ${tile.name}`}
            >
              <X className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PickerHeader({
  label,
  description,
  hint,
  count,
  disabled,
  busy,
  pasting,
  onPick,
  onPaste,
}: {
  label: string;
  description: string;
  hint?: string;
  count: number;
  disabled?: boolean;
  busy?: boolean;
  pasting?: boolean;
  onPick: () => void;
  onPaste: () => void;
}) {
  const atLimit = count >= MAX_ATTACHMENTS_PER_ENTITY;
  const blocked = disabled || busy || atLimit;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>
          {label}{" "}
          <span className="font-normal text-muted-foreground">
            ({count}/{MAX_ATTACHMENTS_PER_ENTITY})
          </span>
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          {/* A button, not just the printed shortcut: the keystroke alone is invisible, and users
              could not find it (a real complaint from the pilot). This reads the clipboard and
              feeds the exact same `handleFiles` path. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPaste}
            disabled={blocked || pasting}
            title="Paste a screenshot from the clipboard"
          >
            {pasting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ClipboardPaste className="mr-2 h-4 w-4" />
            )}
            Paste screenshot
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPick}
            disabled={blocked}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-2 h-4 w-4" />
            )}
            Add pictures
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}


/**
 * Pictures on a saved transaction. Loads, adds and removes them against the API.
 */
export function AttachmentUploader({
  entityType,
  entityId,
  className,
}: {
  entityType: AttachmentEntityType;
  entityId: number;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const queryKey = ["/api/attachments", entityType, entityId];

  const listQuery = useQuery({
    queryKey,
    queryFn: () => listAttachments(entityType, entityId),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteAttachment(id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const attachments = listQuery.data ?? [];
  const remaining = Math.max(0, MAX_ATTACHMENTS_PER_ENTITY - attachments.length);

  const handleFiles = async (picked: File[]) => {
    if (picked.length === 0) return;

    setError(null);
    setBusy(true);

    try {
      if (remaining === 0) {
        setError(
          `This transaction already carries ${MAX_ATTACHMENTS_PER_ENTITY} pictures. Remove one first.`
        );
        return;
      }
      if (picked.length > remaining) {
        setError(
          `Only ${remaining} more picture(s) fit - the limit is ${MAX_ATTACHMENTS_PER_ENTITY} per transaction.`
        );
      }

      for (const file of picked.slice(0, remaining)) {
        const problem = attachmentFileError(file);
        if (problem) {
          setError(problem);
          continue;
        }
        try {
          await uploadAttachment(entityType, entityId, file);
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
        }
      }

      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusy(false);
    }
  };

  // A pasted screenshot takes the same path as a picked file: cap, validation, upload.
  usePasteImages((files) => void handleFiles(files), !busy);

  // The "Paste screenshot" button: same path again, just triggered by a click instead of Cmd+V.
  const pasteFromClipboard = async () => {
    setPasting(true);
    try {
      const { files, error: pasteError } = await readClipboardImages();
      if (pasteError) setError(pasteError);
      if (files.length > 0) await handleFiles(files);
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <PickerHeader
        label="Proof pictures"
        description={ATTACHMENT_HELP_TEXT}
        hint={PASTE_HINT}
        count={attachments.length}
        busy={busy || listQuery.isLoading}
        pasting={pasting}
        onPick={() => inputRef.current?.click()}
        onPaste={() => void pasteFromClipboard()}
      />

      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = "";
          void handleFiles(picked);
        }}
      />

      {listQuery.isError ? (
        <p className="text-sm text-destructive">
          {listQuery.error instanceof Error
            ? listQuery.error.message
            : "The pictures could not be loaded."}
        </p>
      ) : null}

      <AttachmentTiles
        tiles={attachments.map((attachment) => ({
          key: String(attachment.id),
          url: attachment.url,
          name: attachment.fileName,
        }))}
        onRemove={(key) => remove.mutate(Number(key))}
        removing={remove.isPending}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Pictures picked while the transaction is still being created.
 *
 * The files never leave the browser until the parent saves the record and calls
 * `uploadAttachmentFiles` with the new id.
 */
export function PendingAttachmentPicker({
  files,
  onFilesChange,
  label = "Receipt / bank-transfer pictures",
  description = ATTACHMENT_HELP_TEXT,
  disabled,
  className,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  // Object URLs are the only way to preview a File before it is uploaded; revoke them when the
  // selection changes or the dialog closes so the browser can release the memory.
  const tiles = useMemo(
    () =>
      files.map((file, index) => ({
        key: String(index),
        url: URL.createObjectURL(file),
        name: file.name,
      })),
    [files]
  );

  useEffect(() => {
    return () => {
      tiles.forEach((tile) => URL.revokeObjectURL(tile.url));
    };
  }, [tiles]);

  const remaining = Math.max(0, MAX_ATTACHMENTS_PER_ENTITY - files.length);

  const handleFiles = (picked: File[]) => {
    if (picked.length === 0) return;

    setError(null);

    if (remaining === 0) {
      setError(
        `You can attach ${MAX_ATTACHMENTS_PER_ENTITY} pictures. Remove one to choose another.`
      );
      return;
    }

    const accepted: File[] = [];
    let problem: string | null = null;

    for (const file of picked.slice(0, remaining)) {
      const fileProblem = attachmentFileError(file);
      if (fileProblem) problem = fileProblem;
      else accepted.push(file);
    }

    if (picked.length > remaining) {
      problem = `Only ${remaining} more picture(s) fit - the limit is ${MAX_ATTACHMENTS_PER_ENTITY} per transaction.`;
    }

    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
    setError(problem);
  };

  // Pasted screenshots land here too - same cap, same validation, same staged list.
  usePasteImages(handleFiles, !disabled);

  // Same handler behind the "Paste screenshot" button, for people who never press Cmd+V.
  const pasteFromClipboard = async () => {
    setPasting(true);
    try {
      const { files: pasted, error: pasteError } = await readClipboardImages();
      if (pasteError) setError(pasteError);
      else handleFiles(pasted);
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <PickerHeader
        label={label}
        description={description}
        hint={PASTE_HINT}
        count={files.length}
        disabled={disabled}
        pasting={pasting}
        onPick={() => inputRef.current?.click()}
        onPaste={() => void pasteFromClipboard()}
      />

      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = "";
          handleFiles(picked);
        }}
      />

      <AttachmentTiles
        tiles={tiles}
        onRemove={(key) => onFilesChange(files.filter((_, index) => index !== Number(key)))}
        removing={disabled}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

