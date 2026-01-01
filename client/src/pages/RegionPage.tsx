import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Search, MapPin, User, Trash2, Edit } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-permissions";
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

const createRegionSchema = z.object({
  name: z.string().min(1, "Region name is required"),
  description: z.string().optional(),
  managerUserId: z.string().optional(),
});

type CreateRegionFormValues = z.infer<typeof createRegionSchema>;

interface Region {
  id: number;
  name: string;
  description: string | null;
  managerUserId: number | null;
  managerUser?: {
    id: number;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface User {
  id: number;
  username: string;
  role: {
    id: number;
    name: string;
    hierarchyLevel: string;
  };
}

function RegionPage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [regionToDelete, setRegionToDelete] = useState<Region | null>(null);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const canCreate = hasPermission('stores', 'create');
  const canUpdate = hasPermission('stores', 'update');
  const canDelete = hasPermission('stores', 'delete');

  const form = useForm<CreateRegionFormValues>({
    resolver: zodResolver(createRegionSchema),
    defaultValues: {
      name: '',
      description: '',
      managerUserId: '',
    },
  });

  const { data: regions, isLoading, error, refetch: refetchRegions } = useQuery<Region[]>({
    queryKey: ['/api/regions'],
  });

  // Log errors for debugging
  if (error) {
    console.error('Error fetching regions:', error);
  }

  const { data: users } = useQuery<User[]>({
    queryKey: ['/api/users'],
  });

  // Filter users to show only regional managers
  const regionalManagers = users?.filter(user =>
    user.role?.hierarchyLevel === 'regional_manager'
  );

  const createRegionMutation = useMutation({
    mutationFn: async (data: CreateRegionFormValues) => {
      const response = await fetch('/api/regions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          managerUserId: data.managerUserId ? parseInt(data.managerUserId) : undefined,
        }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      refetchRegions();
      setDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Region created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const updateRegionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CreateRegionFormValues }) => {
      const response = await fetch(`/api/regions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          managerUserId: data.managerUserId ? parseInt(data.managerUserId) : undefined,
        }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      refetchRegions();
      setDialogOpen(false);
      setEditingRegion(null);
      form.reset();
      toast({ title: "Success", description: "Region updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deleteRegionMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/regions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      refetchRegions();
      setDeleteDialogOpen(false);
      setRegionToDelete(null);
      toast({ title: "Success", description: "Region deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const onSubmit = async (data: CreateRegionFormValues) => {
    try {
      if (editingRegion) {
        await updateRegionMutation.mutateAsync({ id: editingRegion.id, data });
      } else {
        await createRegionMutation.mutateAsync(data);
      }
    } catch (error) {
      console.error('Error saving region:', error);
    }
  };

  const handleEdit = (region: Region) => {
    setEditingRegion(region);
    form.reset({
      name: region.name,
      description: region.description || '',
      managerUserId: region.managerUserId?.toString() || '',
    });
    setDialogOpen(true);
  };

  const handleDelete = (region: Region) => {
    setRegionToDelete(region);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (regionToDelete) {
      await deleteRegionMutation.mutateAsync(regionToDelete.id);
    }
  };

  const filteredRegions = regions?.filter(region =>
    search.trim() === '' ||
    region.name.toLowerCase().includes(search.toLowerCase()) ||
    (region.description && region.description.toLowerCase().includes(search.toLowerCase())) ||
    (region.managerUser && region.managerUser.username.toLowerCase().includes(search.toLowerCase()))
  );

  const isPending = createRegionMutation.isPending || updateRegionMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Region Management</h1>
          <p className="text-muted-foreground">
            Manage geographical regions and regional manager assignments for hierarchical access control
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingRegion(null);
                form.reset();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Region
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {editingRegion ? 'Edit Region' : 'Create New Region'}
                  </DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Region Name</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g., Northern Region" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (Optional)</FormLabel>
                          <FormControl>
                            <Textarea {...field} placeholder="Brief description of the region" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="managerUserId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Regional Manager (Optional)</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select regional manager" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">No Manager</SelectItem>
                              {regionalManagers?.map((user) => (
                                <SelectItem key={user.id} value={user.id.toString()}>
                                  {user.username}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {editingRegion ? 'Update Region' : 'Create Region'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Regions</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search regions..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
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
                  <TableHead>Region Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Regional Manager</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRegions?.map((region) => (
                  <TableRow key={region.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {region.name}
                      </div>
                    </TableCell>
                    <TableCell>{region.description || '-'}</TableCell>
                    <TableCell>
                      {region.managerUser ? (
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="secondary">
                            {region.managerUser.username}
                          </Badge>
                        </div>
                      ) : (
                        <Badge variant="outline">No Manager</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(region.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canUpdate && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(region)}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(region)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Region</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the region "{regionToDelete?.name}"?
              This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete Region
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default RegionPage;
