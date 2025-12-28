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
import type { InsertUser, SelectUser, SelectRole } from "@db/schema";
import { insertUserSchema } from "@db/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Plus, Pencil, Trash2, Filter, RefreshCw } from "lucide-react";
import { FC } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface UserWithRole extends Omit<SelectUser, 'roleId'> {
  role: SelectRole;
  storeAssignments?: {
    id: number;
    storeId: number;
    userId: number;
    store: {
      id: number;
      name: string;
      regionId: number | null;
    }
  }[];
}

function UsersPage() {
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filters, setFilters] = useState({
    roleId: 'all',
    hierarchyLevel: 'all',
    storeId: 'all'
  });
  const { toast } = useToast();

  const { data: users, isLoading, refetch } = useQuery<UserWithRole[]>({
    queryKey: ['/api/users'],
  });

  const { data: roles } = useQuery<SelectRole[]>({
    queryKey: ['/api/roles'],
  });

  const { data: stores } = useQuery<any[]>({
    queryKey: ['/api/stores'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertUser) => {
      const res = await fetch('/api/users', {
        method: 'POST',
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
      toast({ title: "Success", description: "User created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertUser> }) => {
      // If password is empty string, remove it from the update data
      if (data.password === '') {
        const { password, ...rest } = data;
        data = rest;
      }

      const res = await fetch(`/api/users/${id}`, {
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
      toast({ title: "Success", description: "User updated successfully" });
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
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "User deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const form = useForm<InsertUser>({
    resolver: zodResolver(insertUserSchema),
    defaultValues: {
      username: "",
      password: "",
      roleId: undefined,
    },
  });

  const filteredUsers = users?.filter((user: UserWithRole) => {
    const matchesSearch = user.username.toLowerCase().includes(search.toLowerCase());
    const matchesRole = filters.roleId === 'all' || user.role.id.toString() === filters.roleId;
    const matchesHierarchy = filters.hierarchyLevel === 'all' || user.role.hierarchyLevel === filters.hierarchyLevel;
    const matchesStore = filters.storeId === 'all' ||
      user.storeAssignments?.some(sa => sa.storeId.toString() === filters.storeId);

    return matchesSearch && matchesRole && matchesHierarchy && matchesStore;
  });

  const onSubmit = async (data: InsertUser) => {
    try {
      if (editingUser) {
        await updateMutation.mutateAsync({
          id: editingUser.id,
          data: {
            username: data.username,
            password: data.password, // Include password in update
            roleId: data.roleId
          }
        });
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const handleEditUser = (user: UserWithRole) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: "", // Reset password field
      roleId: user.role.id,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingUser(null);
              form.reset({
                username: "",
                password: "",
                roleId: undefined,
              });
            }}>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{editingUser ? 'New Password (leave empty to keep current)' : 'Password'}</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="roleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        value={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {roles?.map((role: SelectRole) => (
                            <SelectItem key={role.id} value={role.id.toString()}>
                              {role.name} {role.isSystemAdmin ? '(Admin)' : ''}
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
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingUser ? 'Update User' : 'Create User'}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User List</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <Accordion type="single" collapsible className="mt-4">
            <AccordionItem value="filters">
              <AccordionTrigger className="text-sm">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Advanced Filters
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-1">
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Role</label>
                    <Select
                      value={filters.roleId}
                      onValueChange={(v) => setFilters(prev => ({ ...prev, roleId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Roles" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        {roles?.map(role => (
                          <SelectItem key={role.id} value={role.id.toString()}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium">Hierarchy Level</label>
                    <Select
                      value={filters.hierarchyLevel}
                      onValueChange={(v) => setFilters(prev => ({ ...prev, hierarchyLevel: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Levels" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Levels</SelectItem>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="dc_manager">DC Manager</SelectItem>
                        <SelectItem value="regional">Regional Manager</SelectItem>
                        <SelectItem value="global">Global Manager</SelectItem>
                        <SelectItem value="admin">System Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium">Store Assignment</label>
                    <Select
                      value={filters.storeId}
                      onValueChange={(v) => setFilters(prev => ({ ...prev, storeId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Stores" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Stores</SelectItem>
                        {stores?.map(store => (
                          <SelectItem key={store.id} value={store.id.toString()}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFilters({
                        roleId: 'all',
                        hierarchyLevel: 'all',
                        storeId: 'all'
                      });
                      setSearch("");
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-2" />
                    Reset
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
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
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Hierarchy</TableHead>
                  <TableHead>Store Assignments</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers?.map((user: UserWithRole) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.role.isSystemAdmin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                        {user.role.name}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">
                      {user.role.hierarchyLevel.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.storeAssignments && user.storeAssignments.length > 0 ? (
                          user.storeAssignments.map(sa => (
                            <span key={sa.id} className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px]">
                              {sa.store.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 italic text-xs">Global / No direct store</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleEditUser(user)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this user?')) {
                              deleteMutation.mutate(user.id);
                            }
                          }}
                          disabled={user.role.name === 'admin'} // Prevent deleting admin users
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

export default UsersPage;