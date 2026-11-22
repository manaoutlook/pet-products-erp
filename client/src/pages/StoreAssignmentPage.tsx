import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
import { useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { SelectStore, SelectUser } from "@db/schema";
import { useRestBulkDelete } from "@/hooks/use-bulk-delete";
import {
  MasterDataBulkDeleteDialog,
  MasterDataBulkDeleteToolbar,
} from "@/components/master-data/MasterDataBulkDelete";

type StoreUser = SelectUser & {
  role: {
    id: number;
    name: string;
    isSystemAdmin: boolean;
  };
};

type StoreAssignment = {
  id: number;
  userId: number;
  storeId: number;
  user: SelectUser & {
    role: {
      name: string;
      isSystemAdmin: boolean;
    };
  };
  store: SelectStore;
};

function StoreAssignmentPage() {
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: storeUsers, isLoading: isLoadingUsers } = useQuery<StoreUser[]>({
    queryKey: ['/api/store-assignments/users'],
    queryFn: async () => {
      const response = await fetch('/api/store-assignments/users', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      return response.json();
    }
  });

  const { data: stores, isLoading: isLoadingStores } = useQuery<SelectStore[]>({
    queryKey: ['/api/stores'],
    queryFn: async () => {
      const response = await fetch('/api/stores', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch stores');
      }
      return response.json();
    }
  });

  const { data: assignments, isLoading: isLoadingAssignments, refetch: refetchAssignments } = useQuery<StoreAssignment[]>({
    queryKey: ['/api/store-assignments'],
    queryFn: async () => {
      const response = await fetch('/api/store-assignments', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch assignments');
      }
      return response.json();
    }
  });

  // Users are sorted alphabetically and the role is shown as secondary text so
  // the dropdown is searchable by either the username or the role. Users who
  // already have the selected store are hidden - the API rejects a duplicate
  // assignment, so offering them would only produce an error after clicking.
  const userOptions = useMemo(() => {
    const assignedUserIds = new Set(
      selectedStore
        ? (assignments ?? [])
            .filter((assignment) => assignment.storeId === Number(selectedStore))
            .map((assignment) => assignment.userId)
        : []
    );

    return [...(storeUsers ?? [])]
      .filter((user) => !assignedUserIds.has(user.id))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((user) => ({
        value: user.id.toString(),
        label: user.username,
        description: user.role?.name.replace(/_/g, " ") ?? null,
      }));
  }, [storeUsers, assignments, selectedStore]);

  const storeOptions = useMemo(
    () =>
      [...(stores ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((store) => ({
          value: store.id.toString(),
          label: store.name,
          description: `${store.type === "WAREHOUSE" ? "Warehouse" : "Retail"} · ${store.location}`,
        })),
    [stores]
  );

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column.
  const assignmentsTable = useTableControls(assignments, {
    user: (assignment: StoreAssignment) => assignment.user.username,
    store: (assignment: StoreAssignment) => assignment.store.name,
  });

  const bulkDelete = useRestBulkDelete({
    endpoint: '/api/store-assignments',
    singular: 'assignment',
    plural: 'assignments',
    getLabel: (id) => {
      const assignment = assignments?.find((item) => item.id === id);
      return assignment
        ? `${assignment.user.username} → ${assignment.store.name}`
        : `#${id}`;
    },
    onDeleted: () => refetchAssignments(),
  });

  const visibleAssignmentIds = (assignmentsTable.rows ?? []).map(
    (assignment: StoreAssignment) => assignment.id
  );
  const visibleSelection = bulkDelete.selectionState(visibleAssignmentIds);

  const createAssignmentMutation = useMutation({
    mutationFn: async (data: { userId: number; storeId: number }) => {
      const res = await fetch('/api/store-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetchAssignments();
      setDialogOpen(false);
      toast({ title: "Success", description: "Store assignment created successfully", variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/store-assignments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetchAssignments();
      toast({ title: "Success", description: "Store assignment deleted successfully", variant: "success" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleAssignment = async () => {
    if (!selectedUser || !selectedStore) {
      toast({
        title: "Error",
        description: "Please select both user and store",
        variant: "destructive"
      });
      return;
    }

    try {
      await createAssignmentMutation.mutateAsync({
        userId: parseInt(selectedUser),
        storeId: parseInt(selectedStore),
      });
      setSelectedUser("");
      setSelectedStore("");
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const isLoading = isLoadingUsers || isLoadingStores || isLoadingAssignments;

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Store Assignments</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Assign Store
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Assign Store to User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="store-assignment-user" className="text-sm font-medium">
                  Select User
                </label>
                <SearchableSelect
                  id="store-assignment-user"
                  value={selectedUser || null}
                  onChange={(value) => setSelectedUser(value ?? "")}
                  options={userOptions}
                  placeholder="Select a user"
                  searchPlaceholder="Search users by name or role..."
                  emptyMessage="No user found."
                  disabled={isLoadingUsers}
                />
                <p className="text-xs text-muted-foreground">
                  Type to search. The list scrolls and shows each user's role.
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="store-assignment-store" className="text-sm font-medium">
                  Select Store
                </label>
                <SearchableSelect
                  id="store-assignment-store"
                  value={selectedStore || null}
                  onChange={(value) => {
                    const nextStore = value ?? "";
                    setSelectedStore(nextStore);
                    // Keep the form valid if the chosen store already has this user.
                    if (
                      nextStore &&
                      selectedUser &&
                      assignments?.some(
                        (assignment) =>
                          assignment.storeId === Number(nextStore) &&
                          assignment.userId === Number(selectedUser)
                      )
                    ) {
                      setSelectedUser("");
                    }
                  }}
                  options={storeOptions}
                  placeholder="Select a store"
                  searchPlaceholder="Search stores by name or location..."
                  emptyMessage="No store found."
                  disabled={isLoadingStores}
                />
                <p className="text-xs text-muted-foreground">
                  Users already assigned to the chosen store are hidden from the list.
                </p>
              </div>

              <Button
                className="w-full"
                onClick={handleAssignment}
                disabled={
                  createAssignmentMutation.isPending ||
                  !selectedUser ||
                  !selectedStore
                }
              >
                {createAssignmentMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Assign Store
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
            <TableControlsBar controls={assignmentsTable} noun="assignments" />
            <MasterDataBulkDeleteToolbar
              count={bulkDelete.selectedCount}
              plural="assignments"
              onClear={bulkDelete.clearSelection}
              onRequestDelete={() => bulkDelete.setIsDeleteDialogOpen(true)}
              isPending={bulkDelete.isPending}
            />
            <Table className="table-actions-sticky min-w-[840px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 align-top">
                    <Checkbox
                      aria-label="Select all store assignments"
                      checked={
                        visibleSelection.allSelected
                          ? true
                          : visibleSelection.someSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={() => bulkDelete.toggleSelectAll(visibleAssignmentIds)}
                    />
                  </TableHead>
                  <ColumnHeader controls={assignmentsTable} columnKey="user" label="User" filterPlaceholder="Filter user" />
                  <ColumnHeader controls={assignmentsTable} columnKey="store" label="Store" filterPlaceholder="Filter store" />
                  <TableHead className="align-top">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignmentsTable.rows.map((assignment: StoreAssignment) => (
                  <TableRow key={assignment.id} data-state={bulkDelete.isSelected(assignment.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${assignment.user.username} at ${assignment.store.name}`}
                        checked={bulkDelete.isSelected(assignment.id)}
                        onCheckedChange={() => bulkDelete.toggleSelection(assignment.id)}
                      />
                    </TableCell>
                    <TableCell>{assignment.user.username}</TableCell>
                    <TableCell>{assignment.store.name}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm('Are you sure you want to remove this assignment?')) {
                            deleteAssignmentMutation.mutate(assignment.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      <MasterDataBulkDeleteDialog
        open={bulkDelete.isDeleteDialogOpen}
        onOpenChange={bulkDelete.setIsDeleteDialogOpen}
        count={bulkDelete.selectedCount}
        singular="assignment"
        plural="assignments"
        isPending={bulkDelete.isPending}
        onConfirm={bulkDelete.confirmDelete}
      />
    </div>
  );
}

export default StoreAssignmentPage;
