import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProductSelector } from "@/components/POS/ProductSelector";
import { CartManager } from "@/components/POS/CartManager";
import { ReceiptPrinter } from "@/components/POS/ReceiptPrinter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Store, User, RefreshCw, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";

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

interface ReceiptData {
  invoiceNumber: string;
  transactionDate: string;
  cashierName: string;
  storeName?: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
}

function POSPage() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [userStore, setUserStore] = useState<Store | null>(null);

  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    }) => {
      const response = await fetch('/api/sales-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: data.items,
          paymentMethod: data.paymentMethod,
          customerProfileId: data.customerProfileId,
          transactionType: userStore ? 'STORE_SALE' : 'DC_SALE',
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
      // Create receipt data
      const subtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
      const tax = subtotal * 0.1;
      const total = subtotal + tax;

      const receipt: ReceiptData = {
        invoiceNumber: data.transaction.invoiceNumber,
        transactionDate: data.transaction.transactionDate,
        cashierName: user?.username || 'Unknown',
        storeName: userStore?.name,
        items: cartItems,
        subtotal,
        tax,
        total,
        paymentMethod: data.transaction.paymentMethod,
      };

      setReceiptData(receipt);
      setShowReceipt(true);
      setCartItems([]);
      setIsProcessing(false);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });

      toast({
        title: "Sale Completed",
        description: `Transaction ${data.transaction.invoiceNumber} completed successfully`,
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

  const handleCheckout = async (paymentMethod: string) => {
    if (cartItems.length === 0) return;

    setIsProcessing(true);

    const saleData = {
      items: cartItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        inventoryId: item.inventoryId,
      })),
      paymentMethod,
    };

    createSaleMutation.mutate(saleData);
  };

  const handleCloseReceipt = () => {
    setShowReceipt(false);
    setReceiptData(null);
  };

  const handlePrintReceipt = () => {
    // Receipt printing is handled by ReceiptPrinter component
    toast({
      title: "Receipt Printed",
      description: "Receipt has been sent to printer",
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
            onPrint={handlePrintReceipt}
            onClose={handleCloseReceipt}
          />
        </div>
      )}

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
