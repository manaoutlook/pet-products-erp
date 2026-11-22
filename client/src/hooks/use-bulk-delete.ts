import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { readApiError } from "@/lib/apiError";

/**
 * Multi-select + bulk delete for screens whose REST API exposes the normal
 * single-record delete (`DELETE /api/<collection>/:id`) but no bulk endpoint.
 *
 * It keeps the same contract as `useMasterDataBulkDelete`, so the shared
 * `MasterDataBulkDeleteToolbar` / `MasterDataBulkDeleteDialog` components can
 * be reused. Each delete runs through the existing endpoint, which means the
 * server's own guards (last admin, role in use, store still referenced, ...)
 * still apply. Records the server refuses stay selected so the user can fix
 * the reference and retry.
 */

export interface RestBulkDeleteFailure {
  id: number;
  name: string | null;
  message: string;
}

export interface RestBulkDeleteResult {
  message: string;
  deletedCount: number;
  failedCount: number;
  deleted: number[];
  failed: RestBulkDeleteFailure[];
}

interface UseRestBulkDeleteOptions {
  /** REST collection, e.g. "/api/users" - deletes go to `${endpoint}/${id}` */
  endpoint: string;
  /** "user" */
  singular: string;
  /** "users" */
  plural: string;
  /** Human readable name for error reporting, e.g. the username. */
  getLabel?: (id: number) => string | null | undefined;
  /** Called after a successful request so the list can be refetched. */
  onDeleted?: () => void;
}

export function useRestBulkDelete({
  endpoint,
  singular,
  plural,
  getLabel,
  onDeleted,
}: UseRestBulkDeleteOptions) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async (ids: number[]): Promise<RestBulkDeleteResult> => {
      const outcomes = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`${endpoint}/${id}`, {
              method: "DELETE",
              credentials: "include",
            });
            if (!res.ok) {
              return { id, message: await readApiError(res) };
            }
            return { id, message: null };
          } catch (error) {
            return {
              id,
              message:
                error instanceof Error ? error.message : "Delete request failed",
            };
          }
        })
      );

      const deleted = outcomes.filter((outcome) => outcome.message === null).map((outcome) => outcome.id);
      const failed = outcomes
        .filter((outcome) => outcome.message !== null)
        .map((outcome) => ({
          id: outcome.id,
          name: getLabel?.(outcome.id) ?? null,
          message: outcome.message as string,
        }));

      const message =
        failed.length === 0
          ? `${deleted.length} ${deleted.length === 1 ? singular : plural} deleted`
          : deleted.length === 0
            ? `Could not delete the selected ${plural}`
            : `${deleted.length} of ${ids.length} ${plural} deleted`;

      return {
        message,
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed,
      };
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
      const everyVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => prev.includes(id));
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
    mutation.mutate(selectedIds);
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

export default useRestBulkDelete;
