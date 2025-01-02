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
import { Loader2, Search, Plus, Pencil, Trash2 } from "lucide-react";

interface UserWithRole extends Omit<SelectUser, 'roleId'> {
  role: SelectRole & {
    roleLocation: {
      id: number;
      description: string;
    };
  };
}

function UsersPage() {
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: users, isLoading, refetch } = useQuery<UserWithRole[]>({
    queryKey: ['/api/users'],
  });

  const { data: roles } = useQuery<SelectRole[]>({
    queryKey: ['/api/roles'],
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

  const filteredUsers = users?.filter(user => 
    user.username.toLowerCase().includes(search.toLowerCase())
  );

  const onSubmit = async (data: InsertUser) => {
    try {
      if (editingUser) {
        await updateMutation.mutateAsync({ 
          id: editingUser.id, 
          data: {
            username: data.username,
            password: data.password, 
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
    if (user.role.name === 'admin') {
      toast({ 
        title: "Warning", 
        description: "The admin user cannot be edited",
        variant: "destructive"
      });
      return;
    }
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: "", 
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
                          {roles?.map(role => (
                            <SelectItem key={role.id} value={role.id.toString()}>
                              {role.name} ({role.roleLocation?.description})
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
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>
                      {user.role.name}{user.role.roleLocation ? ` (${user.role.roleLocation.description})` : ''}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleEditUser(user)}
                          disabled={user.role.name === 'admin'}
                          className={user.role.name === 'admin' ? 'cursor-not-allowed opacity-50' : ''}
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
                          disabled={user.role.name === 'admin'} 
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