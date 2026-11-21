import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, ShoppingCart, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/utils/format";
import { sumLineTotals } from "@shared/tax";
import { PosQtyStepper } from "./PosQtyStepper";

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
}

interface CartItem {
  productId: number;
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  inventoryId: number;
}

interface CartManagerProps {
  cartItems: CartItem[];
  onUpdateQuantity: (productId: number, quantity: number) => void;
  onRemoveItem: (productId: number) => void;
  onClearCart: () => void;
  onCheckout: (paymentMethod: string) => void;
  isProcessing?: boolean;
}

export function CartManager({
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onCheckout,
  isProcessing = false,
}: CartManagerProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("cash");
  const { toast } = useToast();

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  // AI Agent Note: catalogue prices are VAT-EXCLUSIVE and the VAT choice is made at checkout
  // ("Print with VAT?"), so the cart shows the VAT-exclusive subtotal and nothing else. The old
  // `subtotal * 0.1` here was one of three copies of the 10% rule and made the till disagree
  // with the sale it was about to write. The final total (with or without VAT) is shown in the
  // checkout dialog, computed by shared/tax.ts - the same function the server stores from.
  const subtotal = sumLineTotals(
    cartItems.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice }))
  );

  const paymentMethods = [
    { id: "cash", label: "Cash", icon: "💵" },
    { id: "card", label: "Card", icon: "💳" },
    { id: "digital", label: "Digital Wallet", icon: "📱" },
  ];

  const handleCheckout = () => {
    if (cartItems.length === 0) {
      toast({
        title: "Empty Cart",
        description: "Add some items to the cart before checkout",
        variant: "destructive",
      });
      return;
    }

    onCheckout(selectedPaymentMethod);
  };

  if (cartItems.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Shopping Cart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Your cart is empty</p>
            <p className="text-sm">Add some products to get started</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Shopping Cart
            {/* Same header shape as the product panel: title plus a count badge. */}
            <Badge variant="secondary" className="ml-auto mr-2 text-xs font-normal">
              {totalItems} {totalItems === 1 ? "item" : "items"}
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearCart}
            disabled={isProcessing}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0">
        <ScrollArea className="flex-1 px-6 pb-4">
          <div className="space-y-2">
            {cartItems.map((item) => (
              <Card key={item.productId} className="px-3 py-2">
                {/* Line 1 - same shape as the product list: name, SKU, category, brand */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h4
                    className="min-w-[8rem] flex-1 truncate text-sm font-medium"
                    title={item.product.name}
                  >
                    {item.product.name}
                  </h4>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    SKU: {item.product.sku}
                  </span>
                  <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">
                    {item.product.category.name}
                  </Badge>
                  {item.product.brand && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
                      {item.product.brand.name}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0 text-destructive hover:text-destructive"
                    onClick={() => onRemoveItem(item.productId)}
                    disabled={isProcessing}
                    aria-label={`Remove ${item.product.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Line 2 - the product list says where the stock sits; the cart does not need it */}

                {/* Line 3 - unit price, quantity, line total */}
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="min-w-[6rem] shrink-0 text-sm font-semibold tabular-nums">
                    {formatCurrency(item.unitPrice)}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">each</span>

                  <PosQtyStepper
                    quantity={item.quantity}
                    onChange={(quantity) => onUpdateQuantity(item.productId, quantity)}
                    min={1}
                    disabled={isProcessing}
                    itemName={item.product.name}
                  />

                  <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                    {formatCurrency(item.totalPrice)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t bg-muted/50 px-6 py-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal (excl. VAT):</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>VAT:</span>
              <span>Asked at checkout</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold text-lg">
              <span>Total so far:</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium mb-2 block">Payment Method</label>
              <div className="grid grid-cols-1 gap-2">
                {paymentMethods.map((method) => (
                  <Button
                    key={method.id}
                    variant={selectedPaymentMethod === method.id ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => setSelectedPaymentMethod(method.id)}
                    disabled={isProcessing}
                  >
                    <span className="mr-2">{method.icon}</span>
                    {method.label}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleCheckout}
              className="w-full"
              size="lg"
              disabled={isProcessing || cartItems.length === 0}
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {isProcessing ? "Processing..." : `Checkout - ${formatCurrency(subtotal)}`}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
