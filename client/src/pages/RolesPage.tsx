import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast"; // Corrected import path
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Shield, Trash } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { insertRoleSchema, type InsertRole, type SelectRole } from "@db/schema";
import { fetchApi } from "@/lib/api";
import { useRolePermissions } from "@/hooks/use-role-permissions";

const formSchema = insertRoleSchema.pick({
  name: true,
  description: true,
  roleTypeId: true,
});

function RolesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<SelectRole | null>(null);

  const { toast } = useToast();
  const { hasPermission } = useRolePermissions();

  const createMutation = useMutation({
    mutationFn: async (data: InsertRole) => {
      return fetchApi("/api/roles", {
        method: "POST",
        body: JSON.stringify(data),
        credentials: 'include'
      });
    },
    onSuccess: () => {
      refetch();
      setDialogOpen(false);
      toast({ title: "Success", description: "Role created successfully" });
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create role",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; data: InsertRole }) => {
      return fetchApi(`/api/roles/${data.id}`, {
        method: "PUT",
        body: JSON.stringify(data.data),
        credentials: 'include'
      });
    },
    onSuccess: () => {
      refetch();
      setDialogOpen(false);
      setEditingRole(null);
      form.reset();
      toast({ title: "Success", description: "Role updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update role",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return fetchApi(`/api/roles/${id}`, {
        method: "DELETE",
        credentials: 'include'
      });
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Role deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete role",
        variant: "destructive",
      });
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const { data: roles, refetch, isLoading } = useQuery<SelectRole[]>({
    queryKey: ["/api/roles"],
  });

  const { data: roleTypes, isLoading: isLoadingRoleTypes } = useQuery({
    queryKey: ["/api/role-types"],
  });

  function onOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditingRole(null);
      form.reset({
        name: "",
        description: "",
      });
    }
  }

  function handleEdit(role: SelectRole) {
    setEditingRole(role);
    form.reset({
      name: role.name,
      description: role.description || "",
      roleTypeId: role.roleTypeId,
    });
    setDialogOpen(true);
  }

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (editingRole) {
      updateMutation.mutateAsync({ 
        id: editingRole.id, 
        data: data as InsertRole 
      });
    } else {
      createMutation.mutateAsync(data as InsertRole);
    }
  }

  async function handleDelete(id: number) {
    if (window.confirm("Are you sure you want to delete this role?")) {
      deleteMutation.mutateAsync(id);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
        {hasPermission("users", "create") && (
          <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Role
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingRole ? "Edit Role" : "Add New Role"}</DialogTitle>
                <DialogDescription>
                  {editingRole
                    ? "Edit an existing role in the system."
                    : "Add a new role to the system. Roles control what actions users can perform."}
                </DialogDescription>
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
                          <Input placeholder="Enter role name" {...field} />
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
                          <Textarea placeholder="Enter role description" {...field} />
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
                          defaultValue={field.value?.toString()}
                          value={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select role type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {!isLoadingRoleTypes &&
                              roleTypes?.map((type) => (
                                <SelectItem key={type.id} value={type.id.toString()}>
                                  {type.description}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end space-x-2">
                    <DialogClose asChild>
                      <Button variant="outline" type="button">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button type="submit">
                      {editingRole ? "Update Role" : "Create Role"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Role Type</TableHead>
                {hasPermission("users", "update") && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : (
                roles?.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>{role.description}</TableCell>
                    <TableCell>{role.roleType?.description}</TableCell>
                    {hasPermission("users", "update") && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(role)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {role.name !== "admin" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(role.id)}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default RolesPage;