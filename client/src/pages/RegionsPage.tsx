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
import type { InsertRegion, SelectRegion, SelectUser } from "@db/schema";
import { insertRegionSchema } from "@db/schema";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Plus, Pencil, Trash2, MapIcon } from "lucide-react";

function RegionsPage() {
    const [search, setSearch] = useState("");
    const [editingRegion, setEditingRegion] = useState<SelectRegion | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const { toast } = useToast();

    const { data: regions, isLoading, refetch } = useQuery<(SelectRegion & { manager?: SelectUser, stores?: any[] })[]>({
        queryKey: ['/api/regions'],
        queryFn: async () => {
            const response = await fetch('/api/regions', {
                credentials: 'include'
            });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }
    });

    const { data: users } = useQuery<SelectUser[]>({
        queryKey: ['/api/users'],
        queryFn: async () => {
            const response = await fetch('/api/users', {
                credentials: 'include'
            });
            if (!response.ok) throw new Error(await response.text());
            return response.json();
        }
    });

    const form = useForm<InsertRegion>({
        resolver: zodResolver(insertRegionSchema),
        defaultValues: {
            name: "",
            description: "",
            managerUserId: undefined,
        },
    });

    const createMutation = useMutation({
        mutationFn: async (data: InsertRegion) => {
            const res = await fetch('/api/regions', {
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

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number; data: InsertRegion }) => {
            const res = await fetch(`/api/regions/${id}`, {
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

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/regions/${id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            refetch();
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

    const onSubmit = async (data: InsertRegion) => {
        try {
            if (editingRegion) {
                await updateMutation.mutateAsync({
                    id: editingRegion.id,
                    data
                });
            } else {
                await createMutation.mutateAsync(data);
            }
        } catch (error) {
            // Error is handled by the mutation
        }
    };

    const handleAddRegion = () => {
        setEditingRegion(null);
        form.reset({
            name: "",
            description: "",
            managerUserId: undefined,
        });
        setDialogOpen(true);
    };

    const handleEditRegion = (region: SelectRegion) => {
        setEditingRegion(region);
        form.reset({
            name: region.name,
            description: region.description || "",
            managerUserId: region.managerUserId || undefined,
        });
        setDialogOpen(true);
    };

    const handleDeleteRegion = async (region: SelectRegion) => {
        if (confirm('Are you sure you want to delete this region?')) {
            try {
                await deleteMutation.mutateAsync(region.id);
            } catch (error) {
                // Error is handled by the mutation
            }
        }
    };

    const filteredRegions = regions?.filter((region: SelectRegion) =>
        region.name.toLowerCase().includes(search.toLowerCase()) ||
        (region.description?.toLowerCase() || "").includes(search.toLowerCase())
    );

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold tracking-tight">Regions</h1>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button onClick={handleAddRegion}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Region
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingRegion ? 'Edit Region' : 'Add New Region'}</DialogTitle>
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
                                                <Input
                                                    {...field}
                                                    placeholder="Enter region name"
                                                />
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
                                                <Input
                                                    {...field}
                                                    value={field.value || ""}
                                                    placeholder="Enter region description"
                                                />
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
                                            <FormLabel>Regional Manager</FormLabel>
                                            <Select
                                                onValueChange={(val) => field.onChange(val === 'none' ? null : parseInt(val))}
                                                defaultValue={field.value?.toString() || 'none'}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select manager" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="none">No Manager</SelectItem>
                                                    {users?.map(user => (
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
                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={form.formState.isSubmitting}
                                >
                                    {form.formState.isSubmitting && (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    {editingRegion ? 'Update Region' : 'Create Region'}
                                </Button>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Region List</CardTitle>
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
                                    <TableHead>Manager</TableHead>
                                    <TableHead>Stores</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredRegions?.map((region) => (
                                    <TableRow key={region.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <MapIcon className="h-4 w-4 text-purple-500" />
                                                {region.name}
                                            </div>
                                        </TableCell>
                                        <TableCell>{region.description}</TableCell>
                                        <TableCell>{region.manager?.username || 'No Manager'}</TableCell>
                                        <TableCell>{region.stores?.length || 0} stores</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => handleEditRegion(region)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="text-destructive"
                                                    onClick={() => handleDeleteRegion(region)}
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

export default RegionsPage;
