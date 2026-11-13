import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/utils/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { ColumnHeader, TableControlsBar } from "@/components/ui/table-controls";
import { useTableControls } from "@/hooks/use-table-controls";
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
import { useCompanyInfo } from "@/hooks/use-company";
import { ReceiptPrinter, type ReceiptData } from "@/components/POS/ReceiptPrinter";
import { InvoicePrintDialog } from "@/components/POS/InvoicePrint";
import type { InvoicePayload } from "@shared/invoice";

interface SalesTransaction {
  id: number;
  invoiceNumber: string;
  transactionDate: string;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  printedWithVat: boolean;
  vatCompanyId: number | null;
  archivedDocumentUrl: string | null;
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
    productCode?: string;
    description?: string;
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

function ReceiptsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");

  // A4 invoice state (same payload shape the POS uses).
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState<InvoicePayload | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  // Reprints carry the same letterhead as the original receipt.
  const { company } = useCompanyInfo();

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

  // Header controls: click a column header to sort it (asc -> desc -> none) and
  // use the small input under a header to filter that single column. The search
  // term itself is handled server side by the receipts query.
  const receiptsTable = useTableControls(receiptsQuery.data ?? [], {
    invoiceNumber: (transaction: SalesTransaction) => transaction.invoiceNumber,
    transactionDate: (transaction: SalesTransaction) => new Date(transaction.transactionDate),
    cashier: (transaction: SalesTransaction) => transaction.cashierUser?.username || 'Unknown',
    store: (transaction: SalesTransaction) => transaction.store?.name || 'DC',
    total: (transaction: SalesTransaction) => parseFloat(transaction.totalAmount),
    status: (transaction: SalesTransaction) => transaction.status,
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
        variant: "success",
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
        variant: "success",
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

  /**
   * Load the A4 invoice for one sale.
   *
   * Same endpoint the POS uses: the payload is built server-side from the stored sale, and the
   * PDF/document that was issued is served from the archive, so this reprint and the copy
   * printed at the till are the same document.
   */
  const openInvoice = async (transactionId: number) => {
    setInvoiceOpen(true);
    setInvoice(null);
    setInvoiceLoading(true);

    try {
      const response = await fetch(`/api/sales-transactions/${transactionId}/invoice`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to load the invoice');
      }

      const data = await response.json();
      setInvoice(data.invoice);
    } catch (error) {
      setInvoiceOpen(false);
      toast({
        title: "Invoice unavailable",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleViewReceipt = (transaction: SalesTransaction) => {
    // AI Agent Note: these are the stored numbers of the sale. This used to back-calculate the
    // tax with `total / 1.1`, so a 100,000 sale reprinted as 90,909.09 + 9,090.91 while the same
    // sale printed 110,000 at the till. Never derive one of these from another here.
    const receiptData: ReceiptData = {
      invoiceNumber: transaction.invoiceNumber,
      transactionDate: transaction.transactionDate,
      cashierName: transaction.cashierUser?.username || 'Unknown',
      storeName: transaction.store?.name,
      items: transaction.items.map(item => ({
        productId: item.productId,
        // Snapshot first: a product renamed after the sale must not change this receipt.
        product: {
          ...item.product,
          name: item.description?.trim() || item.product.name,
          sku: item.productCode?.trim() || item.product.sku,
        },
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalPrice: parseFloat(item.totalPrice),
        inventoryId: item.id,
      })),
      subtotal: parseFloat(transaction.subtotal ?? '0'),
      tax: parseFloat(transaction.vatAmount ?? '0'),
      total: parseFloat(transaction.totalAmount),
      paymentMethod: transaction.paymentMethod,
      vatRate: parseFloat(transaction.vatRate ?? '0'),
      withVat: transaction.printedWithVat,
      status: transaction.status,
    };

    setSelectedReceipt(receiptData);
    setShowReceiptModal(true);
  };

  const handlePrintReceipt = () => {
    toast({
      title: "Receipt Printed",
      description: "Receipt has been sent to printer",
      variant: "success",
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
        return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'cancelled':
        return <Badge variant="secondary"><Ban className="h-3 w-3 mr-1" />Cancelled</Badge>;
      case 'refunded':
        return <Badge variant="warning"><RotateCcw className="h-3 w-3 mr-1" />Refunded</Badge>;
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
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
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
              <SearchInput
                id="search"
                containerClassName="mt-1"
                placeholder="e.g., STR001-20241210-0001, 123, or customer name"
                value={searchTerm}
                onValueChange={setSearchTerm}
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
            <>
            <TableControlsBar controls={receiptsTable} noun="receipts" />
            <Table className="table-actions-sticky min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <ColumnHeader controls={receiptsTable} columnKey="invoiceNumber" label="Invoice #" filterPlaceholder="Filter invoice #" />
                  <ColumnHeader controls={receiptsTable} columnKey="transactionDate" label="Date" filterPlaceholder="Filter date" />
                  <ColumnHeader controls={receiptsTable} columnKey="cashier" label="Cashier" filterPlaceholder="Filter cashier" />
                  <ColumnHeader controls={receiptsTable} columnKey="store" label="Store" filterPlaceholder="Filter store" />
                  <ColumnHeader controls={receiptsTable} columnKey="total" label="Amount" filterPlaceholder="Filter amount" />
                  <ColumnHeader controls={receiptsTable} columnKey="status" label="Status" filterPlaceholder="Filter status" />
                  <TableHead className="align-top text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiptsTable.rows.map((transaction: SalesTransaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium">
                      {transaction.invoiceNumber}
                    </TableCell>
                    <TableCell>
                      {formatDate(transaction.transactionDate)}
                    </TableCell>
                    <TableCell>
                      {transaction.cashierUser?.username || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {transaction.store?.name || 'DC'}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(transaction.totalAmount)}
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

                        {/*
                          The A4 tax invoice. Rebuilt from the stored sale and printed from the
                          archived copy, so it is byte-for-byte the document that was issued -
                          including the product names as they were then.
                        */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openInvoice(transaction.id)}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Invoice
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
                                    variant="create"
                                    onClick={() => handleRefundTransaction(transaction.id)}
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
            </>
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
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <ReceiptPrinter
              receiptData={selectedReceipt}
              company={company}
              onPrint={handlePrintReceipt}
              onClose={() => {
                setShowReceiptModal(false);
                setSelectedReceipt(null);
              }}
            />
          </div>
        </div>
      )}
      {/* A4 invoice of the selected sale - printed from the archived issued copy */}
      <InvoicePrintDialog
        invoice={invoice}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        loading={invoiceLoading}
        onArchived={() => {
          queryClient.invalidateQueries({ queryKey: ['/api/sales-transactions'] });
        }}
      />
    </div>
  );
}

export default ReceiptsPage;
