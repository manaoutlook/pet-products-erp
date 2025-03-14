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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { InsertRole, SelectRole, SelectRoleType } from "@db/schema";
import { insertRoleSchema } from "@db/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Plus, Pencil, Trash2 } from "lucide-react";

function RolesPage() {
  const [search, setSearch] = useState("");
  const [editingRole, setEditingRole] = useState<SelectRole | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: roles, isLoading, refetch } = useQuery<SelectRole[]>({
    queryKey: ['/api/roles'],
  });

  const { data: roleTypes } = useQuery<SelectRoleType[]>({
    queryKey: ['/api/role-types'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertRole) => {
      console.log("Sending create role request with data:", data);
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });

      console.log("Create role response status:", res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("API error response:", errorText);
        throw new Error(errorText);
      }

      const responseData = await res.json();
      console.log("Create role success response:", responseData);
      return responseData;
    },
    onSuccess: (data) => {
      console.log("Role created successfully:", data);
      refetch();
      toast({ title: "Success", description: "Role created successfully" });
    },
    onError: (error: Error) => {
      console.error("Create role mutation error:", error);
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create role",
        variant: "destructive"
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertRole> }) => {
      const res = await fetch(`/api/roles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setDialogOpen(false);
      toast({ title: "Success", description: "Role updated successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/roles/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Role deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const form = useForm<InsertRole>({
    resolver: zodResolver(insertRoleSchema),
    defaultValues: {
      name: "",
      description: "",
      roleTypeId: undefined,
    },
  });

  const filteredRoles = roles?.filter(role => 
    role.name.toLowerCase().includes(search.toLowerCase()) ||
    role.description?.toLowerCase().includes(search.toLowerCase())
  );

  const onSubmit = async (data: InsertRole) => {
    try {
      console.log("Form submission triggered with data:", data);

      // Validate required fields
      if (!data.name) {
        console.error("Name is required");
        toast({ 
          title: "Validation Error", 
          description: "Role name is required",
          variant: "destructive"
        });
        return;
      }

      if (!data.roleTypeId) {
        console.error("Role Type is required");
        toast({ 
          title: "Validation Error", 
          description: "Role Type is required",
          variant: "destructive"
        });
        return;
      }

      if (editingRole) {
        console.log("Updating role:", data);
        await updateMutation.mutateAsync({ 
          id: editingRole.id,
          data 
        });
      } else {
        console.log("Creating role:", data);
        await createMutation.mutateAsync(data);
      }
      setDialogOpen(false);
      form.reset();
    } catch (error) {
      console.error("Error submitting form:", error);
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    }
  };

  const handleAddRole = () => {
    setEditingRole(null);
    form.reset({
      name: "",
      description: "",
      roleTypeId: undefined,
    });
    setDialogOpen(true);
  };

  const handleEditRole = (role: SelectRole) => {
    setEditingRole(role);
    form.reset({
      name: role.name,
      description: role.description || "",
      roleTypeId: role.roleTypeId,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleAddRole}>
              <Plus className="mr-2 h-4 w-4" />
              Add Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingRole ? 'Edit Role' : 'Add New Role'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="roleTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role Type</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        value={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {roleTypes?.map((type) => (
                            <SelectItem
                              key={type.id}
                              value={type.id.toString()}
                            >
                              {type.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingRole ? 'Update Role' : 'Create Role'}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Role List</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search roles..."
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
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Role Type</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoles?.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>{role.description}</TableCell>
                    <TableCell>{role.roleType?.description}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleEditRole(role)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this role?')) {
                              deleteMutation.mutate(role.id);
                            }
                          }}
                          disabled={role.name === 'admin'} // Prevent deleting admin role
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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

export default RolesPage;