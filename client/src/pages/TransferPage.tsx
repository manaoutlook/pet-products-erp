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
import { Loader2, Plus, Search, Eye, CheckCircle, XCircle, Clock, ArrowRight, Package } from "lucide-react";
import { useForm, FormProvider } from "react-hook-form";
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

const createTransferSchema = z.object({
  fromStoreId: z.string().min(1, "Source store is required"),
  toStoreId: z.string().min(1, "Destination store is required"),
  priority: z.enum(["low", "normal", "high", "urgent"], { required_error: "Priority is required" }),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1, "Product is required"),
    quantity: z.number().min(1, "Quantity must be at least 1"),
    notes: z.string().optional(),
  })).min(1, "At least one item is required"),
});

type CreateTransferFormValues = z.infer<typeof createTransferSchema>;

interface TransferRequest {
  id: number;
  transferNumber: string;
  fromStoreId: number;
  toStoreId: number;
  requestedByUserId: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  notes: string | null;
  requestedAt: string;
  updatedAt: string;
  fromStore: {
    id: number;
    name: string;
  } | null;
  toStore: {
    id: number;
    name: string;
  } | null;
  requestedByUser: {
    id: number;
    username: string;
  };
  items: Array<{
    id: number;
    productId: number;
    requestedQuantity: number;
    approvedQuantity: number | null;
    transferredQuantity: number;
    product: {
      id: number;
      name: string;
      sku: string;
    };
  }>;
}

interface Store {
  id: number;
  name: string;
}

interface Product {
  id: number;
  name: string;
  sku: string;
}

function TransferPage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferRequest | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const canCreate = hasPermission('inventory', 'create');

  const form = useForm<CreateTransferFormValues>({
    resolver: zodResolver(createTransferSchema),
    defaultValues: {
      fromStoreId: '',
      toStoreId: '',
      priority: 'normal',
      notes: '',
      items: [{ productId: '', quantity: 1, notes: '' }],
    },
  });

  const { data: transfers, isLoading, refetch: refetchTransfers } = useQuery<TransferRequest[]>({
    queryKey: ['/api/transfer-requests'],
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ['/api/stores'],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ['/api/products'],
  });

  const createTransferMutation = useMutation({
    mutationFn: async (data: CreateTransferFormValues) => {
      const response = await fetch('/api/transfer-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          fromStoreId: data.fromStoreId === 'DC' ? null : parseInt(data.fromStoreId),
          toStoreId: data.toStoreId === 'DC' ? null : parseInt(data.toStoreId),
          items: data.items.map(item => ({
            ...item,
            productId: parseInt(item.productId),
          })),
        }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      refetchTransfers();
      setDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Transfer request created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const onSubmit = async (data: CreateTransferFormValues) => {
    try {
      await createTransferMutation.mutateAsync(data);
    } catch (error) {
      console.error('Error creating transfer:', error);
    }
  };

  const addItem = () => {
    const currentItems = form.getValues('items');
    form.setValue('items', [...currentItems, { productId: '', quantity: 1, notes: '' }]);
  };

  const removeItem = (index: number) => {
    const currentItems = form.getValues('items');
    if (currentItems.length > 1) {
      form.setValue('items', currentItems.filter((_, i) => i !== index));
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: { variant: "secondary" as const, icon: Clock, label: "Pending" },
      approved: { variant: "default" as const, icon: CheckCircle, label: "Approved" },
      rejected: { variant: "destructive" as const, icon: XCircle, label: "Rejected" },
      completed: { variant: "default" as const, icon: CheckCircle, label: "Completed" },
      cancelled: { variant: "outline" as const, icon: XCircle, label: "Cancelled" },
    };

    const config = variants[status as keyof typeof variants] || variants.pending;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const variants = {
      low: "secondary",
      normal: "outline",
      high: "default",
      urgent: "destructive",
    } as const;

    return (
      <Badge variant={variants[priority as keyof typeof variants] || "outline"}>
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </Badge>
    );
  };

  const filteredTransfers = transfers?.filter(transfer =>
    search.trim() === '' ||
    transfer.transferNumber.toLowerCase().includes(search.toLowerCase()) ||
    (transfer.fromStore?.name || 'DC (Distribution Center)').toLowerCase().includes(search.toLowerCase()) ||
    (transfer.toStore?.name || 'DC (Distribution Center)').toLowerCase().includes(search.toLowerCase()) ||
    transfer.requestedByUser.username.toLowerCase().includes(search.toLowerCase())
  );

  const isPending = createTransferMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory Transfers</h1>
          <p className="text-muted-foreground">
            Manage inter-store inventory transfer requests and approvals
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                form.reset();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New Transfer Request
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Transfer Request</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="fromStoreId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Source Store</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select source store" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="DC">DC (Distribution Center)</SelectItem>
                                {stores?.map((store) => (
                                  <SelectItem key={store.id} value={store.id.toString()}>
                                    {store.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="toStoreId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Destination Store</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select destination store" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {stores?.map((store) => (
                                  <SelectItem key={store.id} value={store.id.toString()}>
                                    {store.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select priority" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes (Optional)</FormLabel>
                          <FormControl>
                            <Textarea {...field} placeholder="Additional notes for the transfer request" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-lg font-medium">Transfer Items</h3>
                        <Button type="button" variant="outline" onClick={addItem}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add Item
                        </Button>
                      </div>

                      {form.watch('items').map((_, index) => (
                        <Card key={index}>
                          <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <FormField
                                control={form.control}
                                name={`items.${index}.productId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Product</FormLabel>
                                    <Select
                                      value={field.value}
                                      onValueChange={field.onChange}
                                    >
                                      <FormControl>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select product" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {products?.map((product) => (
                                          <SelectItem key={product.id} value={product.id.toString()}>
                                            {product.name} ({product.sku})
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name={`items.${index}.quantity`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Quantity</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min="1"
                                        {...field}
                                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className="flex items-end gap-2">
                                <FormField
                                  control={form.control}
                                  name={`items.${index}.notes`}
                                  render={({ field }) => (
                                    <FormItem className="flex-1">
                                      <FormLabel>Notes (Optional)</FormLabel>
                                      <FormControl>
                                        <Input {...field} placeholder="Item notes" />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                {form.watch('items').length > 1 && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => removeItem(index)}
                                    className="mb-2"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

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
                        Create Transfer Request
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
          <CardTitle>Transfer Requests</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search transfers..."
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
                  <TableHead>Transfer #</TableHead>
                  <TableHead>From → To</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Requested At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransfers?.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell className="font-medium">
                      {transfer.transferNumber}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{transfer.fromStore?.name || 'DC (Distribution Center)'}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <span>{transfer.toStore?.name || 'DC (Distribution Center)'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getPriorityBadge(transfer.priority)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(transfer.status)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        {transfer.items.length} item{transfer.items.length !== 1 ? 's' : ''}
                      </div>
                    </TableCell>
                    <TableCell>{transfer.requestedByUser.username}</TableCell>
                    <TableCell>
                      {new Date(transfer.requestedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTransfer(transfer);
                          setDetailsDialogOpen(true);
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transfer Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Transfer Details - {selectedTransfer?.transferNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedTransfer && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Transfer Information</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">From:</span>
                      <span>{selectedTransfer.fromStore?.name || 'DC (Distribution Center)'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To:</span>
                      <span>{selectedTransfer.toStore?.name || 'DC (Distribution Center)'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Priority:</span>
                      {getPriorityBadge(selectedTransfer.priority)}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      {getStatusBadge(selectedTransfer.status)}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Requested By:</span>
                      <span>{selectedTransfer.requestedByUser.username}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Requested At:</span>
                      <span>{new Date(selectedTransfer.requestedAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Notes</h4>
                  <p className="text-sm text-muted-foreground">
                    {selectedTransfer.notes || "No notes provided"}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-4">Transfer Items</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Approved</TableHead>
                      <TableHead>Transferred</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTransfer.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.product.name}</TableCell>
                        <TableCell>{item.product.sku}</TableCell>
                        <TableCell>{item.requestedQuantity}</TableCell>
                        <TableCell>
                          {item.approvedQuantity || '-'}
                        </TableCell>
                        <TableCell>{item.transferredQuantity}</TableCell>
                        <TableCell>
                          {item.transferredQuantity === item.requestedQuantity ? (
                            <Badge variant="default">Complete</Badge>
                          ) : item.transferredQuantity > 0 ? (
                            <Badge variant="secondary">Partial</Badge>
                          ) : (
                            <Badge variant="outline">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TransferPage;
