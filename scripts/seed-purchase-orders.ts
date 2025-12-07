import "dotenv/config";
import { db } from "../db/index.js";
import { purchaseOrders, purchaseOrderItems, purchaseOrderActions } from "../db/schema.js";

async function seedPurchaseOrders() {
  console.log("📋 Seeding Purchase Orders...");

  try {
    // Generate unique order number
    function generateOrderNumber(): string {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `PO-${year}${month}-${randomNum}`;
    }

    const purchaseOrderData = [
      // Recent pending orders
      {
        orderNumber: generateOrderNumber(),
        supplierId: 1, // Pet Supplies Plus
        orderDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        deliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        status: 'pending',
        totalAmount: "3750000.00", // VND
        notes: "Urgent restock for downtown store"
      },
      {
        orderNumber: generateOrderNumber(),
        supplierId: 2, // Global Pet Distributors
        orderDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        deliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
        status: 'pending',
        totalAmount: "5200000.00",
        notes: "Breed specific nutrition order"
      },
      {
        orderNumber: generateOrderNumber(),
        supplierId: 3, // Premium Pet Imports
        orderDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        deliveryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
        status: 'approved',
        totalAmount: "2850000.00",
        notes: "Premium brand restock"
      },

      // Completed orders from last month
      {
        orderNumber: generateOrderNumber(),
        supplierId: 4, // Local Pet Warehouse
        orderDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        deliveryDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
        status: 'delivered',
        totalAmount: "1680000.00",
        notes: "Monthly toy restock"
      },
      {
        orderNumber: generateOrderNumber(),
        supplierId: 5, // Pet Nutrition Corp
        orderDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000), // 28 days ago
        deliveryDate: new Date(Date.now() - 23 * 24 * 60 * 60 * 1000), // 23 days ago
        status: 'delivered',
        totalAmount: "2340000.00",
        notes: "Cat food bulk order"
      },
      {
        orderNumber: generateOrderNumber(),
        supplierId: 1, // Pet Supplies Plus
        orderDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
        deliveryDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        status: 'delivered',
        totalAmount: "4120000.00",
        notes: "End of month stock replenishment"
      },

      // Order in progress
      {
        orderNumber: generateOrderNumber(),
        supplierId: 2, // Global Pet Distributors
        orderDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        deliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        status: 'shipped',
        totalAmount: "3180000.00",
        notes: "Priority delivery requested"
      },

      // Cancelled order
      {
        orderNumber: generateOrderNumber(),
        supplierId: 3, // Premium Pet Imports
        orderDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        deliveryDate: null,
        status: 'cancelled',
        totalAmount: "1950000.00",
        notes: "Order cancelled due to stock availability issues"
      }
    ];

    console.log("📝 Creating purchase orders...");
    const createdOrders = [];
    for (const order of purchaseOrderData) {
      const result = await db.insert(purchaseOrders).values(order).returning();
      createdOrders.push(result[0]);
      console.log(`✓ Created order: ${order.orderNumber} (${order.status}) - ${order.totalAmount} VND`);
    }

    // Create purchase order items
    console.log("\n📦 Creating purchase order items...");

    const orderItemsData = [
      // Order 1 - Pending (Pet Supplies Plus)
      { purchaseOrderId: createdOrders[0].id, productId: 2, quantity: 10, unitPrice: "1250000.00", totalPrice: "12500000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[0].id, productId: 3, quantity: 15, unitPrice: "1350000.00", totalPrice: "20250000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[0].id, productId: 14, quantity: 20, unitPrice: "150000.00", totalPrice: "3000000.00", deliveredQuantity: 0 },

      // Order 2 - Pending (Global Pet Distributors)
      { purchaseOrderId: createdOrders[1].id, productId: 4, quantity: 12, unitPrice: "1450000.00", totalPrice: "17400000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[1].id, productId: 5, quantity: 8, unitPrice: "1300000.00", totalPrice: "10400000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[1].id, productId: 19, quantity: 25, unitPrice: "350000.00", totalPrice: "8750000.00", deliveredQuantity: 0 },

      // Order 3 - Approved (Premium Pet Imports)
      { purchaseOrderId: createdOrders[2].id, productId: 6, quantity: 18, unitPrice: "950000.00", totalPrice: "17100000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[2].id, productId: 7, quantity: 14, unitPrice: "1050000.00", totalPrice: "14700000.00", deliveredQuantity: 0 },

      // Order 4 - Delivered (Local Pet Warehouse)
      { purchaseOrderId: createdOrders[3].id, productId: 14, quantity: 30, unitPrice: "150000.00", totalPrice: "4500000.00", deliveredQuantity: 30 },
      { purchaseOrderId: createdOrders[3].id, productId: 15, quantity: 20, unitPrice: "250000.00", totalPrice: "5000000.00", deliveredQuantity: 20 },
      { purchaseOrderId: createdOrders[3].id, productId: 16, quantity: 25, unitPrice: "120000.00", totalPrice: "3000000.00", deliveredQuantity: 25 },
      { purchaseOrderId: createdOrders[3].id, productId: 17, quantity: 40, unitPrice: "180000.00", totalPrice: "7200000.00", deliveredQuantity: 40 },

      // Order 5 - Delivered (Pet Nutrition Corp)
      { purchaseOrderId: createdOrders[4].id, productId: 9, quantity: 50, unitPrice: "650000.00", totalPrice: "32500000.00", deliveredQuantity: 50 },
      { purchaseOrderId: createdOrders[4].id, productId: 10, quantity: 35, unitPrice: "700000.00", totalPrice: "24500000.00", deliveredQuantity: 35 },
      { purchaseOrderId: createdOrders[4].id, productId: 11, quantity: 28, unitPrice: "680000.00", totalPrice: "19040000.00", deliveredQuantity: 28 },

      // Order 6 - Delivered (Pet Supplies Plus)
      { purchaseOrderId: createdOrders[5].id, productId: 2, quantity: 20, unitPrice: "1250000.00", totalPrice: "25000000.00", deliveredQuantity: 20 },
      { purchaseOrderId: createdOrders[5].id, productId: 3, quantity: 16, unitPrice: "1350000.00", totalPrice: "21600000.00", deliveredQuantity: 16 },
      { purchaseOrderId: createdOrders[5].id, productId: 18, quantity: 15, unitPrice: "200000.00", totalPrice: "3000000.00", deliveredQuantity: 15 },

      // Order 7 - Shipped (Global Pet Distributors)
      { purchaseOrderId: createdOrders[6].id, productId: 4, quantity: 14, unitPrice: "1450000.00", totalPrice: "20300000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[6].id, productId: 5, quantity: 10, unitPrice: "1300000.00", totalPrice: "13000000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[6].id, productId: 19, quantity: 18, unitPrice: "350000.00", totalPrice: "6300000.00", deliveredQuantity: 0 },

      // Order 8 - Cancelled (Premium Pet Imports)
      { purchaseOrderId: createdOrders[7].id, productId: 12, quantity: 8, unitPrice: "1200000.00", totalPrice: "9600000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[7].id, productId: 13, quantity: 6, unitPrice: "1250000.00", totalPrice: "7500000.00", deliveredQuantity: 0 },
      { purchaseOrderId: createdOrders[7].id, productId: 20, quantity: 12, unitPrice: "450000.00", totalPrice: "5400000.00", deliveredQuantity: 0 }
    ];

    const createdItems = [];
    for (const item of orderItemsData) {
      const result = await db.insert(purchaseOrderItems).values(item).returning();
      createdItems.push(result[0]);
    }
    console.log(`✓ Created ${createdItems.length} purchase order items`);

    // Create some purchase order actions
    console.log("\n⚡ Creating purchase order actions...");

    const actionsData = [
      // Order 1 - Pending actions
      {
        purchaseOrderId: createdOrders[0].id,
        actionType: 'print',
        actionData: { notes: 'Order printed for approval' },
        performedByUserId: 1, // john_manager
        performedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000) // 2 hours after order creation
      },

      // Order 3 - Approved actions
      {
        purchaseOrderId: createdOrders[2].id,
        actionType: 'print',
        actionData: { notes: 'Order approved and printed' },
        performedByUserId: 10, // regional_boss
        performedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[2].id,
        actionType: 'invoice_received',
        actionData: { reference: 'INV-2024-001' },
        performedByUserId: 6, // anna_inventory
        performedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      },

      // Order 4 - Delivered actions
      {
        purchaseOrderId: createdOrders[3].id,
        actionType: 'print',
        actionData: { notes: 'Monthly restock order' },
        performedByUserId: 7, // tom_inventory
        performedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000 + 1 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[3].id,
        actionType: 'payment_sent',
        actionData: { reference: 'PAY-2024-045' },
        performedByUserId: 10, // regional_boss
        performedAt: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[3].id,
        actionType: 'goods_receipt',
        actionData: { quantity: 115, notes: 'All items received in good condition' },
        performedByUserId: 7, // tom_inventory
        performedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000)
      },

      // Order 5 - Delivered actions
      {
        purchaseOrderId: createdOrders[4].id,
        actionType: 'print',
        actionData: { notes: 'Cat food bulk order' },
        performedByUserId: 6, // anna_inventory
        performedAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[4].id,
        actionType: 'goods_receipt',
        actionData: { quantity: 113, notes: 'Received and inspected' },
        performedByUserId: 8, // jane_service
        performedAt: new Date(Date.now() - 23 * 24 * 60 * 60 * 1000)
      },

      // Order 6 - Delivered actions
      {
        purchaseOrderId: createdOrders[5].id,
        actionType: 'print',
        actionData: { notes: 'End of month replenishment' },
        performedByUserId: 1, // john_manager
        performedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[5].id,
        actionType: 'payment_sent',
        actionData: { reference: 'PAY-2024-038' },
        performedByUserId: 10, // regional_boss
        performedAt: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[5].id,
        actionType: 'goods_receipt',
        actionData: { quantity: 51, notes: 'Full delivery received' },
        performedByUserId: 1, // john_manager
        performedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      },

      // Order 7 - Shipped actions
      {
        purchaseOrderId: createdOrders[6].id,
        actionType: 'print',
        actionData: { notes: 'Priority delivery order' },
        performedByUserId: 2, // sarah_manager
        performedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 1 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[6].id,
        actionType: 'invoice_received',
        actionData: { reference: 'INV-2024-012' },
        performedByUserId: 6, // anna_inventory
        performedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      },

      // Order 8 - Cancelled actions
      {
        purchaseOrderId: createdOrders[7].id,
        actionType: 'print',
        actionData: { notes: 'Order printed' },
        performedByUserId: 10, // regional_boss
        performedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)
      },
      {
        purchaseOrderId: createdOrders[7].id,
        actionType: 'cancel',
        actionData: { notes: 'Cancelled due to supplier stock issues' },
        performedByUserId: 10, // regional_boss
        performedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      }
    ];

    const createdActions = [];
    for (const action of actionsData) {
      const result = await db.insert(purchaseOrderActions).values(action).returning();
      createdActions.push(result[0]);
    }
    console.log(`✓ Created ${createdActions.length} purchase order actions`);

    console.log("\n✅ Purchase orders seeding completed!");
    console.log("\n📊 Summary:");
    console.log(`- ${createdOrders.length} purchase orders created`);
    console.log(`- ${createdItems.length} purchase order items created`);
    console.log(`- ${createdActions.length} purchase order actions created`);

    console.log("\n📋 Order Status Distribution:");
    const statusCounts = createdOrders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  • ${status}: ${count} orders`);
    });

    console.log("\n🏢 Supplier Distribution:");
    const supplierCounts = createdOrders.reduce((acc, order) => {
      acc[order.supplierId] = (acc[order.supplierId] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const supplierNames = {
      1: "Pet Supplies Plus",
      2: "Global Pet Distributors",
      3: "Premium Pet Imports",
      4: "Local Pet Warehouse",
      5: "Pet Nutrition Corp"
    };

    Object.entries(supplierCounts).forEach(([supplierId, count]) => {
      const supplierName = supplierNames[Number(supplierId) as keyof typeof supplierNames];
      console.log(`  • ${supplierName}: ${count} orders`);
    });

  } catch (error) {
    console.error("❌ Error seeding purchase orders:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedPurchaseOrders();
