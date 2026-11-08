import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * Checkbox multi-select + bulk delete shared by the Categories, Brands and
 * Suppliers screens. Mirrors the Products page behaviour:
 *  - only ids of rows that are currently visible are ever selected
 *  - the API deletes what it can and reports the protected entries
 *  - entries that could not be deleted stay selected so they can be retried
 */

export interface MasterDataBulkDeleteResponse {
  message: string;
  deletedCount: number;
  failedCount: number;
  deleted: number[];
  failed: { id: number; name: string | null; message: string }[];
}

interface UseMasterDataBulkDeleteOptions {
  /** REST collection, e.g. "/api/brands" - the request goes to `${endpoint}/bulk-delete` */
  endpoint: string;
  /** "category" / "brand" / "supplier" */
  singular: string;
  /** "categories" / "brands" / "suppliers" */
  plural: string;
  /** Called after a successful request so the list can be refetched. */
  onDeleted?: () => void;
}

export function useMasterDataBulkDelete({
  endpoint,
  singular,
  plural,
  onDeleted,
}: UseMasterDataBulkDeleteOptions) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch(`${endpoint}/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        credentials: "include",
      });

      if (!res.ok) {
        let message = `Failed to delete ${plural}`;
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
          if (body?.suggestion) message = `${message} (${body.suggestion})`;
        } catch {
          // Keep the fallback message when the body is not JSON.
        }
        throw new Error(message);
      }

      return (await res.json()) as MasterDataBulkDeleteResponse;
    },
    onSuccess: (result) => {
      onDeleted?.();
      // Keep whatever could not be deleted selected so the user can retry.
      const deleted = new Set(result.deleted);
      setSelectedIds((prev) => prev.filter((id) => !deleted.has(id)));
      setIsDialogOpen(false);

      if (result.failedCount > 0) {
        const details = result.failed
          .slice(0, 3)
          .map((item) => `${item.name ?? `#${item.id}`}: ${item.message}`)
          .join(" · ");
        toast({
          title: result.deletedCount > 0 ? `${plural} deleted` : "Nothing was deleted",
          description: `${result.message}. ${details}${result.failed.length > 3 ? " …" : ""}`,
          variant: result.deletedCount > 0 ? "success" : "destructive",
        });
        return;
      }

      toast({ title: "Success", description: result.message, variant: "success" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setIsDialogOpen(false);
    },
  });

  const isSelected = (id: number) => selectedIds.includes(id);

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  };

  const clearSelection = () => setSelectedIds([]);

  /** Selects/deselects only the rows currently visible (search aware). */
  const toggleSelectAll = (visibleIds: number[]) => {
    setSelectedIds((prev) => {
      const visible = new Set(visibleIds);
      const everyVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.includes(id));
      if (everyVisibleSelected) return prev.filter((id) => !visible.has(id));
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  const selectionState = (visibleIds: number[]) => {
    const visibleSelected = visibleIds.filter((id) => selectedIds.includes(id)).length;
    return {
      allSelected: visibleIds.length > 0 && visibleSelected === visibleIds.length,
      someSelected: visibleSelected > 0 && visibleSelected < visibleIds.length,
    };
  };

  const confirmDelete = () => {
    if (selectedIds.length === 0) return;
    try {
      mutation.mutate(selectedIds);
    } catch {
      // Reported by the mutation's onError handler.
    }
  };

  return {
    selectedIds,
    selectedCount: selectedIds.length,
    isSelected,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    selectionState,
    isDeleteDialogOpen: isDialogOpen,
    setIsDeleteDialogOpen: setIsDialogOpen,
    isPending: mutation.isPending,
    confirmDelete,
  };
}

/** "3 selected · Clear selection · Delete selected" bar above the table. */
export function MasterDataBulkDeleteToolbar({
  count,
  plural,
  onClear,
  onRequestDelete,
  isPending,
}: {
  count: number;
  plural: string;
  onClear: () => void;
  onRequestDelete: () => void;
  isPending: boolean;
}) {
  if (count === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{count} selected</span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>
      <Button variant="destructive" size="sm" onClick={onRequestDelete} disabled={isPending}>
        <Trash2 className="mr-2 h-4 w-4" />
        Delete selected {plural}
      </Button>
    </div>
  );
}

/** Confirmation dialog used before the bulk delete request is sent. */
export function MasterDataBulkDeleteDialog({
  open,
  onOpenChange,
  count,
  singular,
  plural,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  singular: string;
  plural: string;
  isPending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {count} selected {count === 1 ? singular : plural}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.{" "}
            {plural.charAt(0).toUpperCase() + plural.slice(1)} that are still in use will be
            skipped and reported after the deletion.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open while the request is in flight so the
              // pending state is visible.
              event.preventDefault();
              onConfirm();
            }}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete selected"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default useMasterDataBulkDelete;
