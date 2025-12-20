import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Receipt,
  Search,
  Printer,
  FileText,
  X,
  RotateCcw,
  DollarSign,
  Eye,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Ban,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { usePermissions } from "@/hooks/use-permissions";
import { ReceiptPrinter } from "@/components/POS/ReceiptPrinter";

interface SalesTransaction {
  id: number;
  invoiceNumber: string;
  transactionDate: string;
  totalAmount: string;
  paymentMethod: string;
  status: string;
  transactionType: string;
  cashierUser?: {
    id: number;
    username: string;
  };
  store?: {
    id: number;
    name: string;
  };
  items: Array<{
    id: number;
    productId: number;
    product: {
      id: number;
      name: string;
      sku: string;
      price: string;
    };
    quantity: number;
    unitPrice: string;
    totalPrice: string;
  }>;
}

interface ReceiptData {
  invoiceNumber: string;
  transactionDate: string;
  cashierName: string;
  storeName?: string;
  items: Array<{
    productId: number;
    product: {
      id: number;
      name: string;
      sku: string;
      price: string;
    };
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
}

function ReceiptsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");

  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  // Fetch receipts/transactions
  const receiptsQuery = useQuery({
    queryKey: ['/api/sales-transactions', searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      params.append('limit', '50');

      const response = await fetch(`/api/sales-transactions?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch receipts');
      }

      return response.json();
    },
    enabled: hasPermission('receipts', 'read'),
  });

  // Cancel transaction mutation
  const cancelMutation = useMutation({
    mutationFn: async (transactionId: number) => {
      const response = await fetch(`/api/sales-transactions/${transactionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by user' }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to cancel transaction');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sales-transactions'] });
      toast({
        title: "Transaction Cancelled",
        description: "The transaction has been cancelled successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cancellation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Refund transaction mutation
  const refundMutation = useMutation({
    mutationFn: async ({ transactionId, refundAmount, reason }: {
      transactionId: number;
      refundAmount?: string;
      reason?: string;
    }) => {
      const response = await fetch(`/api/sales-transactions/${transactionId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundAmount: refundAmount || undefined,
          reason: reason || 'Refund processed'
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to process refund');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sales-transactions'] });
      setRefundReason("");
      setRefundAmount("");
      toast({
        title: "Refund Processed",
        description: "The refund has been processed successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Refund Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleViewReceipt = (transaction: SalesTransaction) => {
    // Convert transaction data to receipt format
    const subtotal = parseFloat(transaction.totalAmount) / 1.1;
    const tax = parseFloat(transaction.totalAmount) - subtotal;

    const receiptData: ReceiptData = {
      invoiceNumber: transaction.invoiceNumber,
      transactionDate: transaction.transactionDate,
      cashierName: transaction.cashierUser?.username || 'Unknown',
      storeName: transaction.store?.name,
      items: transaction.items.map(item => ({
        productId: item.productId,
        product: item.product,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalPrice: parseFloat(item.totalPrice),
      })),
      subtotal,
      tax,
      total: parseFloat(transaction.totalAmount),
      paymentMethod: transaction.paymentMethod,
    };

    setSelectedReceipt(receiptData);
    setShowReceiptModal(true);
  };

  const handlePrintReceipt = () => {
    toast({
      title: "Receipt Printed",
      description: "Receipt has been sent to printer",
    });
  };

  const handleCancelTransaction = (transactionId: number) => {
    cancelMutation.mutate(transactionId);
  };

  const handleRefundTransaction = (transactionId: number) => {
    refundMutation.mutate({
      transactionId,
      refundAmount: refundAmount || undefined,
      reason: refundReason || 'Refund processed',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'cancelled':
        return <Badge variant="secondary"><Ban className="h-3 w-3 mr-1" />Cancelled</Badge>;
      case 'refunded':
        return <Badge variant="outline" className="border-orange-200 text-orange-800"><RotateCcw className="h-3 w-3 mr-1" />Refunded</Badge>;
      default:
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />{status}</Badge>;
    }
  };

  const canCancel = (transaction: SalesTransaction) => {
    return ['completed', 'pending'].includes(transaction.status.toLowerCase());
  };

  const canRefund = (transaction: SalesTransaction) => {
    return transaction.status.toLowerCase() === 'completed';
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-medium">Please log in to access receipts</p>
        </div>
      </div>
    );
  }

  if (!hasPermission('receipts', 'read')) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-gray-600">
              You don't have permission to view receipts and transactions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Receipt Management</h1>
          <p className="text-muted-foreground">
            Search, view, print, and manage transaction receipts
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => receiptsQuery.refetch()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="search">Search by Invoice Number, Transaction ID, or Customer</Label>
              <Input
                id="search"
                placeholder="e.g., STR001-20241210-0001, 123, or customer name"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => receiptsQuery.refetch()}
                disabled={receiptsQuery.isLoading}
              >
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Receipts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Transaction Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {receiptsQuery.isLoading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">Loading receipts...</p>
            </div>
          ) : receiptsQuery.data && receiptsQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiptsQuery.data.map((transaction: SalesTransaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium">
                      {transaction.invoiceNumber}
                    </TableCell>
                    <TableCell>
                      {new Date(transaction.transactionDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {transaction.cashierUser?.username || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {transaction.store?.name || 'DC'}
                    </TableCell>
                    <TableCell>
                      ${parseFloat(transaction.totalAmount).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(transaction.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewReceipt(transaction)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewReceipt(transaction)}
                        >
                          <Printer className="h-4 w-4 mr-1" />
                          Print
                        </Button>

                        {hasPermission('receipts', 'update') && canCancel(transaction) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm" className="text-orange-600">
                                <X className="h-4 w-4 mr-1" />
                                Cancel
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Cancel Transaction</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to cancel transaction {transaction.invoiceNumber}?
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleCancelTransaction(transaction.id)}
                                  className="bg-orange-600 hover:bg-orange-700"
                                >
                                  Cancel Transaction
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {hasPermission('receipts', 'update') && canRefund(transaction) && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" className="text-green-600">
                                <DollarSign className="h-4 w-4 mr-1" />
                                Refund
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Process Refund</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <Label htmlFor="refund-amount">Refund Amount (leave empty for full refund)</Label>
                                  <Input
                                    id="refund-amount"
                                    type="number"
                                    step="0.01"
                                    placeholder={`Max: $${parseFloat(transaction.totalAmount).toFixed(2)}`}
                                    value={refundAmount}
                                    onChange={(e) => setRefundAmount(e.target.value)}
                                    className="mt-1"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor="refund-reason">Reason for Refund</Label>
                                  <Input
                                    id="refund-reason"
                                    placeholder="Customer request, defective product, etc."
                                    value={refundReason}
                                    onChange={(e) => setRefundReason(e.target.value)}
                                    className="mt-1"
                                  />
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setRefundAmount("");
                                      setRefundReason("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    onClick={() => handleRefundTransaction(transaction.id)}
                                    className="bg-green-600 hover:bg-green-700"
                                  >
                                    Process Refund
                                  </Button>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No receipts found</p>
              <p className="text-sm">Try adjusting your search criteria</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Modal */}
      {showReceiptModal && selectedReceipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <ReceiptPrinter
            receiptData={selectedReceipt}
            onPrint={handlePrintReceipt}
            onClose={() => {
              setShowReceiptModal(false);
              setSelectedReceipt(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default ReceiptsPage;
