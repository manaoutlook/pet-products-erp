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
          <ScrollArea className="min-h-0 flex-1 px-6 pb-6">
            <div className="space-y-3">
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
                        <Button variant="create"
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
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
