import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProductSelector } from "@/components/POS/ProductSelector";
import { CartManager } from "@/components/POS/CartManager";
import { ReceiptPrinter, type ReceiptData } from "@/components/POS/ReceiptPrinter";
import { InvoicePrintDialog } from "@/components/POS/InvoicePrint";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Store, User, RefreshCw, AlertTriangle, Check, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCompanyInfo } from "@/hooks/use-company";
import { useVatCompanies } from "@/hooks/use-vat-companies";
import { useUser } from "@/hooks/use-user";
import { usePermissions } from "@/hooks/use-permissions";
import { formatCurrency } from "@/utils/format";
import { computeSaleTotals, VAT_RATE } from "@shared/tax";
import type { InvoicePayload } from "@shared/invoice";

interface Product {
  id: number;
  name: string;
  sku: string;
  price: number;
  category: {
    name: string;
  };
  brand: {
    name: string;
  } | null;
  inventory: Array<{
    id: number;
    quantity: number;
    storeId: number | null;
    inventoryType: string;
  }>;
}

interface CartItem {
  productId: number;
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  inventoryId: number;
}

interface Store {
  id: number;
  name: string;
  location: string;
  contactInfo: string;
}

/**
 * A customer profile, the source of the VAT invoice buyer block.
 *
 * `taxId` is absent on rows created before the column existed, so every read here treats it as
 * optional and an empty value just leaves the invoice field blank for the cashier to fill.
 */
interface CustomerProfile {
  id: number;
  mobileNumber: string;
  companyName?: string | null;
  contactPerson: string;
  address: string;
  taxId?: string | null;
  customerType: 'B2B' | 'B2C';
}

/** The buyer block as printed on the invoice; `name` is the only required part. */
const EMPTY_BUYER = {
  name: "",
  companyName: "",
  taxId: "",
  address: "",
  phone: "",
};

function POSPage() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [userStore, setUserStore] = useState<Store | null>(null);

  // ---------------------------------------------------------------------------------------
  // Invoice flow state
  // ---------------------------------------------------------------------------------------
  // The customer's answer to "print with VAT?" is collected BEFORE the sale is written, because
  // the VAT amount and the invoice number sequence (CI-/HI- vs the store's retail sequence)
  // are decided by it. It cannot be added to a completed sale afterwards.
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState("cash");
  const [printWithVat, setPrintWithVat] = useState(false);
  const [selectedVatCompanyId, setSelectedVatCompanyId] = useState<number | null>(null);
  // The buyer block of a VAT invoice. Snapshotted onto the sale by the server, so a later edit
  // to the customer's record cannot change an invoice that was already issued.
  const [buyer, setBuyer] = useState({ ...EMPTY_BUYER });
  // The customer profile the block was filled from (`null` = typed by hand). Kept only to label
  // the form and to warn about a missing tax code - the sale stores the values, not the link.
  const [buyerCustomerId, setBuyerCustomerId] = useState<number | null>(null);

  // The A4 invoice document of the sale that was just completed / is being reprinted.
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState<InvoicePayload | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<number | null>(null);

  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  // The letterhead the receipt will print - the same query the screen header reads.
  const { company } = useCompanyInfo();
  // The two companies a VAT invoice may be issued under (CI / HI).
  const { activeCompanies: vatCompanies } = useVatCompanies();

  // ---------------------------------------------------------------------------------------
  // Buyer: picked from the customer profiles we already keep
  // ---------------------------------------------------------------------------------------
  // A VAT invoice has to show the buyer's registered name, address and tax code, and the cashier
  // should not be re-typing a customer we have on file - that is how a digit gets mistyped on a
  // legal document. The list is only fetched while the checkout dialog is open with VAT selected
  // and only for a user who may read customer profiles; without the permission the block falls
  // back to manual entry instead of failing.
  const canReadCustomers = hasPermission('customerProfiles', 'read');
  const { data: customers = [] } = useQuery<CustomerProfile[]>({
    queryKey: ['/api/customer-profiles'],
    enabled: checkoutOpen && printWithVat && canReadCustomers,
  });

  const customerOptions = useMemo(
    () =>
      customers.map((customer) => ({
        value: String(customer.id),
        // Lead with the company: that is the name a VAT invoice is addressed to.
        label: customer.companyName
          ? `${customer.companyName} — ${customer.contactPerson}`
          : customer.contactPerson,
        description: customer.taxId
          ? `${customer.mobileNumber} · ${customer.taxId}`
          : customer.mobileNumber,
      })),
    [customers]
  );

  /**
   * Fill the buyer block from a customer profile.
   *
   * `null` clears the selection (and the fields) so a walk-in can be typed manually. The values
   * are copied, not linked: the cashier may correct the address on this invoice without editing
   * the customer record, and the sale keeps its own snapshot.
   */
  const selectBuyerCustomer = (customerId: string | null) => {
    if (!customerId) {
      setBuyerCustomerId(null);
      setBuyer({ ...EMPTY_BUYER });
      return;
    }

    const customer = customers.find((entry) => String(entry.id) === customerId);
    if (!customer) return;

    setBuyerCustomerId(customer.id);
    setBuyer({
      name: customer.contactPerson,
      companyName: customer.companyName ?? "",
      taxId: customer.taxId ?? "",
      address: customer.address,
      phone: customer.mobileNumber,
    });
  };

  const selectedBuyerCustomer =
    customers.find((customer) => customer.id === buyerCustomerId) ?? null;

  // Get user's assigned store
  useEffect(() => {
    const fetchUserStore = async () => {
      if (!user) return;

      try {
        // Get user's store assignments
        const assignmentsResponse = await fetch('/api/store-assignments', {
          credentials: 'include',
        });

        if (assignmentsResponse.ok) {
          const assignments = await assignmentsResponse.json();
          if (assignments.length > 0) {
            // Get store details
            const storeResponse = await fetch(`/api/stores/${assignments[0].storeId}`, {
              credentials: 'include',
            });

            if (storeResponse.ok) {
              const storeData = await storeResponse.json();
              setUserStore(storeData);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching user store:', error);
      }
    };

    fetchUserStore();
  }, [user]);

  // Create sales transaction mutation
  const createSaleMutation = useMutation({
    mutationFn: async (data: {
      items: Array<{
        productId: number;
        quantity: number;
        inventoryId: number;
      }>;
      paymentMethod: string;
      customerProfileId?: number;
      /** "Print with VAT?" - the customer's answer, decided before the sale is written. */
      withVat?: boolean;
      vatCompanyId?: number | null;
      /** Buyer block of a VAT invoice - snapshotted onto the sale server-side. */
      buyer?: {
        name: string;
        companyName?: string | null;
        taxId?: string | null;
        address?: string | null;
        phone?: string | null;
      } | null;
    }) => {
      const response = await fetch('/api/sales-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: data.items,
          paymentMethod: data.paymentMethod,
          customerProfileId: data.customerProfileId,
          transactionType: userStore ? 'STORE_SALE' : 'DC_SALE',
          withVat: data.withVat === true,
          vatCompanyId: data.vatCompanyId ?? null,
          buyer: data.buyer ?? null,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create sale');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // -----------------------------------------------------------------------------------
      // Build the till receipt from what the SERVER stored, not from the cart.
      //
      // AI Agent Note: this block used to compute `subtotal * 0.1` in the browser, which is why
      // the till printed 110,000 for a sale the database recorded as 100,000 and a reprint
      // showed 90,909.09 + 9,090.91. `createSale` has already written subtotal / vat_amount /
      // total_amount (shared/tax.ts) - print those numbers and never derive them here.
      // -----------------------------------------------------------------------------------
      const transaction = data.transaction;
      const receipt: ReceiptData = {
        invoiceNumber: transaction.invoiceNumber,
        transactionDate: transaction.transactionDate,
        cashierName: user?.username || 'Unknown',
        storeName: userStore?.name,
        items: (transaction.items ?? []).map((item: any, index: number) => {
          // The line text comes from the snapshot taken at sale time, exactly what the invoice
          // prints - never from the live catalogue entry.
          const sold = cartItems.find((cartItem) => cartItem.productId === item.productId);
          return {
            productId: item.productId,
            product: {
              id: item.productId,
              name: item.description?.trim() || sold?.product.name || item.product?.name || 'Item',
              sku: item.productCode?.trim() || sold?.product.sku || item.product?.sku || '',
              price: item.unitPrice,
            },
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.totalPrice),
            inventoryId: item.inventoryId ?? index,
          };
        }),
        subtotal: Number(transaction.subtotal),
        tax: Number(transaction.vatAmount),
        total: Number(transaction.totalAmount),
        paymentMethod: transaction.paymentMethod,
        vatRate: Number(transaction.vatRate),
        withVat: transaction.printedWithVat === true,
        status: transaction.status,
      };

      setReceiptData(receipt);
      setShowReceipt(true);
      setCartItems([]);
      setIsProcessing(false);
      setPrintWithVat(false);
      setSelectedVatCompanyId(null);
      setBuyer({ name: "", companyName: "", taxId: "", address: "", phone: "" });

      // The A4 invoice follows the receipt: closing the receipt opens the invoice for the sale
      // that was just made, so the cashier sees both documents of one transaction in order.
      setPendingInvoiceId(transaction.id);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sales-transactions'] });

      toast({
        title: "Sale Completed",
        description: `Transaction ${transaction.invoiceNumber} completed successfully`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      setIsProcessing(false);
      toast({
        title: "Sale Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddToCart = (item: CartItem) => {
    setCartItems(prev => {
      const existing = prev.find(cartItem => cartItem.productId === item.productId);
      if (existing) {
        return prev.map(cartItem =>
          cartItem.productId === item.productId
            ? { ...cartItem, quantity: cartItem.quantity + item.quantity, totalPrice: (cartItem.quantity + item.quantity) * cartItem.unitPrice }
            : cartItem
        );
      }
      return [...prev, item];
    });
  };

  const handleUpdateQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }

    setCartItems(prev =>
      prev.map(item =>
        item.productId === productId
          ? { ...item, quantity, totalPrice: quantity * item.unitPrice }
          : item
      )
    );
  };

  const handleRemoveItem = (productId: number) => {
    setCartItems(prev => prev.filter(item => item.productId !== productId));
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  /**
   * Open the invoice document of a sale.
   *
   * The payload comes from `GET /api/sales-transactions/:id/invoice`, which is built from the
   * stored sale (numbers, buyer, product snapshots) - not from this screen's cart. That is why
   * a reprint from the Receipts screen and the copy printed at the till are the same document.
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

  /**
   * Checkout starts by asking the customer's question: "print with VAT?".
   *
   * Nothing is written until the answer is known (see confirmCheckout) - the VAT amount and the
   * invoice number sequence must exist on the sale from the first insert.
   */
  const handleCheckout = async (paymentMethod: string) => {
    if (cartItems.length === 0) return;

    setPendingPaymentMethod(paymentMethod);
    setPrintWithVat(false);
    setSelectedVatCompanyId(null);
    // A buyer from the previous sale must never be inherited: the next customer would otherwise
    // be invoiced under someone else's company and tax code. The cashier picks a profile again.
    setBuyerCustomerId(null);
    setBuyer({ ...EMPTY_BUYER });
    setCheckoutOpen(true);
  };

  /** Write the sale with the cashier's VAT answer attached. */
  const confirmCheckout = () => {
    if (cartItems.length === 0) return;

    if (printWithVat && !selectedVatCompanyId) {
      toast({
        title: "Select a company",
        description: "Choose which company issues the VAT invoice",
        variant: "destructive",
      });
      return;
    }

    if (printWithVat && !buyer.name.trim()) {
      toast({
        title: "Buyer details required",
        description: "A VAT invoice must show the buyer name and address",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setCheckoutOpen(false);

    createSaleMutation.mutate({
      items: cartItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        inventoryId: item.inventoryId,
      })),
      paymentMethod: pendingPaymentMethod,
      // A DC sale is an internal transfer, never a customer invoice (the server rejects VAT).
      withVat: printWithVat && Boolean(userStore),
      vatCompanyId: printWithVat && userStore ? selectedVatCompanyId : null,
      buyer: printWithVat
        ? {
            name: buyer.name.trim(),
            companyName: buyer.companyName.trim() || null,
            taxId: buyer.taxId.trim() || null,
            address: buyer.address.trim() || null,
            phone: buyer.phone.trim() || null,
          }
        : null,
    });
  };

  const handleCloseReceipt = () => {
    setShowReceipt(false);
    setReceiptData(null);

    // The invoice follows the receipt for the sale that was just completed.
    if (pendingInvoiceId !== null) {
      const transactionId = pendingInvoiceId;
      setPendingInvoiceId(null);
      void openInvoice(transactionId);
    }
  };

  const handlePrintReceipt = () => {
    // Receipt printing is handled by ReceiptPrinter component
    toast({
      title: "Receipt Printed",
      description: "Receipt has been sent to printer",
      variant: "success",
    });
  };



  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-medium">Please log in to access POS</p>
        </div>
      </div>
    );
  }

  if (!hasPermission('pos', 'read')) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              You don't have permission to access the Point of Sale system.
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
          <h1 className="text-3xl font-bold tracking-tight">Point of Sale</h1>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="text-sm text-muted-foreground">
                Cashier: {user.username}
              </span>
            </div>
            {userStore && (
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                <Badge variant="secondary">{userStore.name}</Badge>
              </div>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/products'] });
            queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Receipt Modal */}
      {showReceipt && receiptData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <ReceiptPrinter
            receiptData={receiptData}
            company={company}
            onPrint={handlePrintReceipt}
            onClose={handleCloseReceipt}
          />
        </div>
      )}

      {/*
        Checkout: "Print with VAT?"
        ---------------------------
        AI Agent Note: HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH is a household business and may NOT issue
        a VAT invoice. If the customer asks for one, the sale is invoiced by one of the licensed
        companies (CI / HI), which prints ITS name, tax code and address and runs its OWN invoice
        number sequence. The answer is part of creating the sale, so it is asked here - before
        anything is written - and can never be changed on a completed sale.
      */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Print with VAT?</DialogTitle>
            <DialogDescription>
              Prices are VAT-exclusive. A VAT invoice adds VAT and is issued under one of the
              licensed companies, with its own invoice number sequence.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={printWithVat ? "outline" : "default"}
                onClick={() => {
                  setPrintWithVat(false);
                  setSelectedVatCompanyId(null);
                }}
              >
                {!printWithVat && <Check className="mr-2 h-4 w-4" />}
                No VAT
              </Button>
              <Button
                type="button"
                variant={printWithVat ? "default" : "outline"}
                onClick={() => setPrintWithVat(true)}
              >
                {printWithVat && <Check className="mr-2 h-4 w-4" />}
                With VAT
              </Button>
            </div>

            {printWithVat && (
              <div className="space-y-2">
                <Label>Company issuing the VAT invoice</Label>
                {vatCompanies.length === 0 ? (
                  <p className="text-sm text-destructive">
                    No VAT company is configured. Add one in Master Data &rarr; VAT Companies.
                  </p>
                ) : (
                  vatCompanies.map((vatCompany) => {
                    const unusable = vatCompany.missingFields.length > 0;
                    return (
                      <Button
                        key={vatCompany.id}
                        type="button"
                        variant={selectedVatCompanyId === vatCompany.id ? "default" : "outline"}
                        className="w-full justify-start h-auto py-2"
                        disabled={unusable}
                        onClick={() => setSelectedVatCompanyId(vatCompany.id)}
                      >
                        <span className="font-mono mr-2">{vatCompany.code}</span>
                        <span className="flex-1 text-left">
                          <span className="block">{vatCompany.name}</span>
                          <span className="block text-xs font-normal opacity-80">
                            {unusable
                              ? `Incomplete: ${vatCompany.missingFields.join(', ')}`
                              : `Tax code: ${vatCompany.taxId}`}
                          </span>
                        </span>
                        {selectedVatCompanyId === vatCompany.id && (
                          <Check className="ml-2 h-4 w-4" />
                        )}
                      </Button>
                    );
                  })
                )}
              </div>
            )}

            {printWithVat && (
              <div className="space-y-2 rounded-md border p-3">
                <Label>Buyer (printed on the VAT invoice)</Label>

                {/* The buyer is a customer we already keep, so the block is picked, not typed.
                    The search box matches the company, the contact person, the phone and the
                    tax code (all of them are in the option's value), so a cashier can find a
                    business by whichever of those the customer quotes at the counter. */}
                <SearchableSelect
                  value={buyerCustomerId === null ? null : String(buyerCustomerId)}
                  onChange={selectBuyerCustomer}
                  options={customerOptions}
                  disabled={!canReadCustomers}
                  placeholder={
                    canReadCustomers
                      ? "Search a customer profile..."
                      : "No permission to read customer profiles - type the buyer below"
                  }
                  searchPlaceholder="Company, contact, phone or tax code..."
                  emptyMessage="No customer matches. Add one under Stores - Customer Profiles."
                  clearLabel="Clear - type a buyer manually"
                />

                <Input
                  placeholder="Buyer / contact name *"
                  value={buyer.name}
                  onChange={(event) =>
                    setBuyer((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
                <Input
                  placeholder="Buyer company"
                  value={buyer.companyName}
                  onChange={(event) =>
                    setBuyer((prev) => ({ ...prev, companyName: event.target.value }))
                  }
                />
                <Input
                  placeholder="Buyer tax code"
                  value={buyer.taxId}
                  onChange={(event) =>
                    setBuyer((prev) => ({ ...prev, taxId: event.target.value }))
                  }
                />
                <Input
                  placeholder="Buyer address"
                  value={buyer.address}
                  onChange={(event) =>
                    setBuyer((prev) => ({ ...prev, address: event.target.value }))
                  }
                />
                <Input
                  placeholder="Buyer phone"
                  value={buyer.phone}
                  onChange={(event) =>
                    setBuyer((prev) => ({ ...prev, phone: event.target.value }))
                  }
                />

                {/* A filled-in block with no tax code is the one case the customer will bounce
                    at the counter, so it is called out here rather than left to the print. */}
                {selectedBuyerCustomer && !selectedBuyerCustomer.taxId?.trim() && (
                  <p className="text-xs text-destructive">
                    {selectedBuyerCustomer.contactPerson} has no tax code on file. Type it above,
                    or add it under Stores &rarr; Customer Profiles so the next invoice fills it in.
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  {selectedBuyerCustomer
                    ? "Filled from the customer profile - correct any field for this invoice only. The sale stores its own copy, so editing the profile later cannot change it."
                    : "Typed once and stored on the sale, so a later change to the customer record cannot alter this invoice."}
                </p>
              </div>
            )}

            {(() => {
              // Preview only: the amounts the server will store, from the same shared rule
              // (shared/tax.ts). The cart total is VAT-exclusive, so this is subtotal + VAT.
              const totals = computeSaleTotals(
                cartItems.reduce((sum, item) => sum + item.totalPrice, 0),
                printWithVat,
                VAT_RATE
              );
              return (
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal (excl. VAT)</span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VAT</span>
                    <span>{formatCurrency(totals.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(totals.total)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmCheckout} disabled={isProcessing}>
              <FileText className="mr-2 h-4 w-4" />
              Complete Sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The issued A4 invoice - opened after the receipt, or as a reprint */}
      <InvoicePrintDialog
        invoice={invoice}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        loading={invoiceLoading}
        onArchived={() => {
          queryClient.invalidateQueries({ queryKey: ['/api/sales-transactions'] });
        }}
      />

      {/* Main POS Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-200px)]">
        {/* Product Selection */}
        <div className="space-y-6">
          <ProductSelector
            onAddToCart={handleAddToCart}
            cartItems={cartItems}
            storeId={userStore?.id}
          />
        </div>

        {/* Cart Management */}
        <div className="space-y-6">
          <CartManager
            cartItems={cartItems}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onClearCart={handleClearCart}
            onCheckout={handleCheckout}
            isProcessing={isProcessing}
          />
        </div>
      </div>



      {/* Status Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>Items in cart: {cartItems.length}</span>
              <Separator orientation="vertical" className="h-4" />
              <span>Total quantity: {cartItems.reduce((sum, item) => sum + item.quantity, 0)}</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Status: {isProcessing ? 'Processing...' : 'Ready'}</span>
              {userStore && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Store: {userStore.name}</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default POSPage;
