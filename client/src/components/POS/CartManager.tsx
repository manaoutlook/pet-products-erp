import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Plus, Minus, ShoppingCart, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/utils/format";
import { sumLineTotals } from "@shared/tax";

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
            Cart ({totalItems} items)
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
        <ScrollArea className="flex-1 px-6">
          <div className="space-y-3 pb-4">
            {cartItems.map((item) => (
              <Card key={item.productId} className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate">{item.product.name}</h4>
                    <p className="text-sm text-muted-foreground">SKU: {item.product.sku}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {item.product.category.name}
                      </Badge>
                      {item.product.brand && (
                        <Badge variant="outline" className="text-xs">
                          {item.product.brand.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveItem(item.productId)}
                    disabled={isProcessing}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
                      disabled={item.quantity <= 1 || isProcessing}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="px-3 py-1 text-sm min-w-[3rem] text-center border rounded">
                      {item.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
                      disabled={isProcessing}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${Number(item.totalPrice).toFixed(2)}</p>
                    <p className="text-sm text-muted-foreground">
                      ${Number(item.unitPrice).toFixed(2)} each
                    </p>
                  </div>
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
