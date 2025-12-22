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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { SelectStore, SelectUser } from "@db/schema";

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

  const { data: petStoreUsers, isLoading: isLoadingUsers } = useQuery<SelectUser[]>({
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
      toast({ title: "Success", description: "Store assignment created successfully" });
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
      toast({ title: "Success", description: "Store assignment deleted successfully" });
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Store to User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Select User</label>
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user" />
                  </SelectTrigger>
                  <SelectContent>
                    {petStoreUsers?.map((user: SelectUser) => (
                      <SelectItem key={user.id} value={user.id.toString()}>
                        {user.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Select Store</label>
                <Select value={selectedStore} onValueChange={setSelectedStore}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores?.map((store: SelectStore) => (
                      <SelectItem key={store.id} value={store.id.toString()}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={handleAssignment}
                disabled={createAssignmentMutation.isPending}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments?.map((assignment: StoreAssignment) => (
                  <TableRow key={assignment.id}>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default StoreAssignmentPage;
