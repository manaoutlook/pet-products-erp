import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Minus, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

interface ProductSelectorProps {
  onAddToCart: (item: CartItem) => void;
  cartItems: CartItem[];
  storeId?: number;
}

export function ProductSelector({ onAddToCart, cartItems, storeId }: ProductSelectorProps) {
  const [search, setSearch] = useState("");
  const [selectedQuantities, setSelectedQuantities] = useState<Record<number, number>>({});
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ['/api/products'],
  });

  const filteredProducts = products?.filter(product =>
    product.name.toLowerCase().includes(search.toLowerCase()) ||
    product.sku.toLowerCase().includes(search.toLowerCase()) ||
    product.category.name.toLowerCase().includes(search.toLowerCase()) ||
    (product.brand?.name.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  const getAvailableStock = (product: Product): number => {
    // Find inventory for this store or DC
    const inventoryItem = product.inventory.find(inv =>
      storeId ? inv.storeId === storeId : inv.inventoryType === 'DC'
    );
    return inventoryItem?.quantity || 0;
  };

  const getCartQuantity = (productId: number): number => {
    const cartItem = cartItems.find(item => item.productId === productId);
    return cartItem?.quantity || 0;
  };

  const handleQuantityChange = (productId: number, quantity: number) => {
    if (quantity < 0) return;

    const product = products?.find(p => p.id === productId);
    if (!product) return;

    const availableStock = getAvailableStock(product);
    const currentCartQuantity = getCartQuantity(productId);
    const maxAllowed = availableStock - currentCartQuantity;

    if (quantity > maxAllowed) {
      toast({
        title: "Insufficient Stock",
        description: `Only ${maxAllowed} more items available for ${product.name}`,
        variant: "destructive",
      });
      return;
    }

    setSelectedQuantities(prev => ({
      ...prev,
      [productId]: quantity,
    }));
  };

  const handleAddToCart = (product: Product) => {
    const quantity = selectedQuantities[product.id] || 1;
    if (quantity <= 0) return;

    const availableStock = getAvailableStock(product);
    const currentCartQuantity = getCartQuantity(product.id);

    if (currentCartQuantity + quantity > availableStock) {
      toast({
        title: "Insufficient Stock",
        description: `Cannot add ${quantity} items. Only ${availableStock - currentCartQuantity} available.`,
        variant: "destructive",
      });
      return;
    }

    // Find the appropriate inventory item
    const inventoryItem = product.inventory.find(inv =>
      storeId ? inv.storeId === storeId : inv.inventoryType === 'DC'
    );

    if (!inventoryItem) {
      toast({
        title: "Error",
        description: "No inventory found for this product",
        variant: "destructive",
      });
      return;
    }

    const cartItem: CartItem = {
      productId: product.id,
      product,
      quantity,
      unitPrice: product.price,
      totalPrice: product.price * quantity,
      inventoryId: inventoryItem.id,
    };

    onAddToCart(cartItem);

    // Reset quantity for this product
    setSelectedQuantities(prev => ({
      ...prev,
      [product.id]: 0,
    }));

    toast({
      title: "Added to Cart",
      description: `${quantity}x ${product.name} added to cart`,
    });
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Product Selection
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading products...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No products found
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {filteredProducts.map((product) => {
              const availableStock = getAvailableStock(product);
              const cartQuantity = getCartQuantity(product.id);
              const selectedQuantity = selectedQuantities[product.id] || 0;
              const isOutOfStock = availableStock - cartQuantity <= 0;

              return (
                <Card key={product.id} className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{product.name}</h4>
                      <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary">{product.category.name}</Badge>
                        {product.brand && (
                          <Badge variant="outline">{product.brand.name}</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-semibold text-lg">${Number(product.price).toFixed(2)}</span>
                        <div className="flex items-center gap-1 text-sm">
                          <span className={isOutOfStock ? "text-red-600" : "text-green-600"}>
                            Stock: {availableStock - cartQuantity}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {!isOutOfStock && (
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex items-center border rounded">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleQuantityChange(product.id, selectedQuantity - 1)}
                          disabled={selectedQuantity <= 0}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="px-3 py-1 text-sm min-w-[3rem] text-center">
                          {selectedQuantity}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleQuantityChange(product.id, selectedQuantity + 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        onClick={() => handleAddToCart(product)}
                        disabled={selectedQuantity <= 0}
                        className="flex-1"
                      >
                        Add to Cart
                      </Button>
                    </div>
                  )}

                  {isOutOfStock && (
                    <div className="mt-3">
                      <Badge variant="destructive" className="w-full justify-center">
                        Out of Stock
                      </Badge>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
