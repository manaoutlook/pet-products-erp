import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Minus, Package } from "lucide-react";
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
    // Find inventory for this store first, then fall back to DC
    let inventoryItem = product.inventory.find(inv =>
      storeId ? inv.storeId === storeId : inv.inventoryType === 'DC'
    );

    // If no store inventory, try DC inventory
    if (!inventoryItem && storeId) {
      inventoryItem = product.inventory.find(inv => inv.inventoryType === 'DC');
    }

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

    // Find the appropriate inventory item - prioritize store inventory, then DC
    let inventoryItem = product.inventory.find(inv =>
      storeId ? inv.storeId === storeId : inv.inventoryType === 'DC'
    );

    // If no store inventory, try DC inventory
    if (!inventoryItem && storeId) {
      inventoryItem = product.inventory.find(inv => inv.inventoryType === 'DC');
    }

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
      variant: "success",
    });
  };

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Product Selection
          {/* The list always runs past the bottom of the panel, so say how many are in it. */}
          {!isLoading && (
            <Badge variant="secondary" className="ml-auto text-xs font-normal">
              {filteredProducts.length} {filteredProducts.length === 1 ? "product" : "products"}
            </Badge>
          )}
        </CardTitle>
        <SearchInput
          placeholder="Search products..."
          value={search}
          onValueChange={setSearch}
        />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading products...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No products found
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1 px-6 pb-4">
            <div className="space-y-2">
              {filteredProducts.map((product) => {
                const availableStock = getAvailableStock(product);
                const cartQuantity = getCartQuantity(product.id);
                const selectedQuantity = selectedQuantities[product.id] || 0;
                const isOutOfStock = availableStock - cartQuantity <= 0;

                return (
                  <Card key={product.id} className="px-3 py-2">
                    {/* Line 1 - what the product is */}
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <h4
                        className="min-w-[8rem] flex-1 truncate text-sm font-medium"
                        title={product.name}
                      >
                        {product.name}
                      </h4>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        SKU: {product.sku}
                      </span>
                      <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">
                        {product.category.name}
                      </Badge>
                      {product.brand && (
                        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
                          {product.brand.name}
                        </Badge>
                      )}
                    </div>

                    {/* Line 2 - price, quantity, add, stock */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        ${Number(product.price).toFixed(2)}
                      </span>

                      {!isOutOfStock && (
                        <>
                          <div className="flex shrink-0 items-center rounded border">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleQuantityChange(product.id, selectedQuantity - 1)}
                              disabled={selectedQuantity <= 0}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="min-w-[2rem] text-center text-sm tabular-nums">
                              {selectedQuantity}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleQuantityChange(product.id, selectedQuantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <Button
                            variant="create"
                            size="sm"
                            className="h-7 px-3 text-xs"
                            onClick={() => handleAddToCart(product)}
                            disabled={selectedQuantity <= 0}
                          >
                            Add to Cart
                          </Button>
                        </>
                      )}

                      {isOutOfStock && (
                        <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[11px]">
                          Out of Stock
                        </Badge>
                      )}

                      <span
                        className={`ml-auto shrink-0 text-xs tabular-nums ${
                          isOutOfStock ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        Stock: {availableStock - cartQuantity}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
