import "dotenv/config";
import { db } from "../db/index.js";
import { inventory } from "../db/schema.js";

async function seedInventory() {
  console.log("📦 Creating Inventory Records...");

  try {
    // Generate barcode function (matching the one in routes.ts)
    function generateInventoryBarcode(
      inventoryType: 'DC' | 'STORE',
      productSku: string,
      storeId?: number | null
    ): string {
      const prefix = inventoryType === 'DC' ? 'DC' : 'ST';
      const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const storePrefix = storeId ? storeId.toString().padStart(3, '0') : '000';
      return `${prefix}${storePrefix}${productSku}${randomNum}`;
    }

    const inventoryData = [
      // Distribution Center Inventory (DC) - Central warehouse stock
      {
        productId: 2, // Royal Canin Medium Adult
        storeId: null, // DC inventory
        supplierId: 1, // Pet Supplies Plus
        quantity: 150,
        location: "Warehouse Aisle A, Shelf 1-3", // DC warehouse location
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'RC-MA-001'),
        purchaseDate: "2024-10-15",
        expiryDate: "2026-10-15"
      },
      {
        productId: 3, // Royal Canin Labrador Retriever
        storeId: null,
        supplierId: 1,
        quantity: 120,
        location: "Warehouse Aisle B, Shelf 2-4",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'RC-LAB-002'),
        purchaseDate: "2024-10-20",
        expiryDate: "2026-10-20"
      },
      {
        productId: 4, // Royal Canin German Shepherd
        storeId: null,
        supplierId: 2, // Global Pet Distributors
        quantity: 100,
        location: "Warehouse Aisle C, Rack 1",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'RC-GS-003'),
        purchaseDate: "2024-10-25",
        expiryDate: "2026-10-25"
      },
      {
        productId: 5, // Royal Canin Bulldog
        storeId: null,
        supplierId: 2,
        quantity: 130,
        location: "Warehouse Aisle C, Rack 2",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'RC-BULL-004'),
        purchaseDate: "2024-11-01",
        expiryDate: "2026-11-01"
      },
      {
        productId: 6, // Purina Pro Plan Adult Chicken
        storeId: null,
        supplierId: 3, // Premium Pet Imports
        quantity: 200,
        location: "Warehouse Section D, Pallet 5",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'PP-AC-005'),
        purchaseDate: "2024-11-05",
        expiryDate: "2026-11-05"
      },
      {
        productId: 7, // Purina Pro Plan Puppy
        storeId: null,
        supplierId: 3,
        quantity: 180,
        location: "Warehouse Section D, Pallet 6",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'PP-PUP-006'),
        purchaseDate: "2024-11-10",
        expiryDate: "2026-11-10"
      },
      {
        productId: 8, // Purina One SmartBlend
        storeId: null,
        supplierId: 4, // Local Pet Warehouse
        quantity: 250,
        location: "Warehouse Zone E, Bin 12",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'PO-SB-007'),
        purchaseDate: "2024-11-15",
        expiryDate: "2026-11-15"
      },
      {
        productId: 9, // Whiskas Adult Tuna
        storeId: null,
        supplierId: 5, // Pet Nutrition Corp
        quantity: 300,
        location: "Warehouse Zone F, Shelf A1-A3",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'WK-AT-008'),
        purchaseDate: "2024-11-20",
        expiryDate: "2026-11-20"
      },
      {
        productId: 10, // Whiskas Kitten
        storeId: null,
        supplierId: 5,
        quantity: 220,
        location: "Warehouse Zone F, Shelf B1-B2",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'WK-KIT-009'),
        purchaseDate: "2024-11-25",
        expiryDate: "2026-11-25"
      },
      {
        productId: 11, // Whiskas Hairball Control
        storeId: null,
        supplierId: 1,
        quantity: 190,
        location: "Warehouse Zone F, Shelf C1",
        inventoryType: 'DC',
        barcode: generateInventoryBarcode('DC', 'WK-HC-010'),
        purchaseDate: "2024-12-01",
        expiryDate: "2026-12-01"
      },

      // Store Inventory - Downtown Pet Store (Store ID: 1)
      {
        productId: 2, // Royal Canin Medium Adult
        storeId: 1, // Downtown Pet Store
        supplierId: 1,
        quantity: 25,
        location: "Back Room Shelf A, Row 2", // Store storage location
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'RC-MA-001', 1),
        purchaseDate: "2024-11-15",
        expiryDate: "2026-11-15"
      },
      {
        productId: 6, // Purina Pro Plan Adult Chicken
        storeId: 1,
        supplierId: 3,
        quantity: 30,
        location: "Back Room Shelf B, Row 1",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PP-AC-005', 1),
        purchaseDate: "2024-11-20",
        expiryDate: "2026-11-20"
      },
      {
        productId: 9, // Whiskas Adult Tuna
        storeId: 1,
        supplierId: 5,
        quantity: 40,
        location: "Display Area Storage, Bin 3",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'WK-AT-008', 1),
        purchaseDate: "2024-11-25",
        expiryDate: "2026-11-25"
      },
      {
        productId: 14, // Rubber Chew Toy
        storeId: 1,
        supplierId: 2,
        quantity: 50,
        location: "Toy Section Storage, Shelf 1",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PT-RCT-013', 1),
        purchaseDate: "2024-12-01"
      },
      {
        productId: 16, // Cat Wand Toy
        storeId: 1,
        supplierId: 4,
        quantity: 35,
        location: "Toy Section Storage, Shelf 2",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PT-CWT-015', 1),
        purchaseDate: "2024-12-05"
      },
      {
        productId: 18, // Adjustable Dog Collar
        storeId: 1,
        supplierId: 1,
        quantity: 20,
        location: "Accessory Rack, Position 5",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PA-ADC-017', 1),
        purchaseDate: "2024-12-10"
      },

      // Store Inventory - Suburban Pet Center (Store ID: 2)
      {
        productId: 3, // Royal Canin Labrador Retriever
        storeId: 2, // Suburban Pet Center
        supplierId: 2,
        quantity: 20,
        location: "Storage Room Aisle 1, Bay 2",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'RC-LAB-002', 2),
        purchaseDate: "2024-11-18",
        expiryDate: "2026-11-18"
      },
      {
        productId: 7, // Purina Pro Plan Puppy
        storeId: 2,
        supplierId: 3,
        quantity: 28,
        location: "Storage Room Aisle 1, Bay 3",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PP-PUP-006', 2),
        purchaseDate: "2024-11-22",
        expiryDate: "2026-11-22"
      },
      {
        productId: 10, // Whiskas Kitten
        storeId: 2,
        supplierId: 5,
        quantity: 32,
        location: "Cat Food Section Storage, Rack A",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'WK-KIT-009', 2),
        purchaseDate: "2024-11-28",
        expiryDate: "2026-11-28"
      },
      {
        productId: 15, // Interactive Puzzle Toy
        storeId: 2,
        supplierId: 3,
        quantity: 15,
        location: "Toy Storage Area, Box 7",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PT-IPT-014', 2),
        purchaseDate: "2024-12-02"
      },
      {
        productId: 17, // Squeaky Ball Set
        storeId: 2,
        supplierId: 4,
        quantity: 45,
        location: "Toy Storage Area, Box 8",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PT-SBS-016', 2),
        purchaseDate: "2024-12-06"
      },
      {
        productId: 19, // Leather Dog Leash
        storeId: 2,
        supplierId: 2,
        quantity: 18,
        location: "Accessory Storage, Drawer 4",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PA-LDL-018', 2),
        purchaseDate: "2024-12-12"
      },

      // Store Inventory - Mall Pet Boutique (Store ID: 3)
      {
        productId: 4, // Royal Canin German Shepherd
        storeId: 3, // Mall Pet Boutique
        supplierId: 2,
        quantity: 15,
        location: "Premium Storage Room, Shelf 3",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'RC-GS-003', 3),
        purchaseDate: "2024-11-21",
        expiryDate: "2026-11-21"
      },
      {
        productId: 8, // Purina One SmartBlend
        storeId: 3,
        supplierId: 4,
        quantity: 35,
        location: "Premium Storage Room, Shelf 4",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PO-SB-007', 3),
        purchaseDate: "2024-11-26",
        expiryDate: "2026-11-26"
      },
      {
        productId: 11, // Whiskas Hairball Control
        storeId: 3,
        supplierId: 1,
        quantity: 28,
        location: "Cat Care Section Storage, Unit 2",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'WK-HC-010', 3),
        purchaseDate: "2024-12-01",
        expiryDate: "2026-12-01"
      },
      {
        productId: 12, // Hill's Science Diet Adult
        storeId: 3,
        supplierId: 3,
        quantity: 12,
        location: "Premium Food Storage, Cabinet A",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'HS-AC-011', 3),
        purchaseDate: "2024-12-03",
        expiryDate: "2026-12-03"
      },
      {
        productId: 13, // Hill's Science Diet Kitten
        storeId: 3,
        supplierId: 3,
        quantity: 10,
        location: "Premium Food Storage, Cabinet B",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'HS-KIT-012', 3),
        purchaseDate: "2024-12-04",
        expiryDate: "2026-12-04"
      },
      {
        productId: 20, // Cat Scratching Post
        storeId: 3,
        supplierId: 5,
        quantity: 8,
        location: "Large Item Storage, Area 1",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PA-CSP-019', 3),
        purchaseDate: "2024-12-08"
      },
      {
        productId: 21, // Pedigree Dental Chews
        storeId: 3,
        supplierId: 4,
        quantity: 22,
        location: "Health Product Storage, Shelf C",
        inventoryType: 'STORE',
        barcode: generateInventoryBarcode('STORE', 'PH-DC-020', 3),
        purchaseDate: "2024-12-14",
        expiryDate: "2026-12-14"
      }
    ];

    const createdInventory = [];
    for (const item of inventoryData) {
      const result = await db.insert(inventory).values(item).returning();
      createdInventory.push(result[0]);
      const storeInfo = item.storeId ? `Store ${item.storeId}` : 'DC';
      console.log(`✓ Created inventory: Product ${item.productId} at ${storeInfo} (${item.quantity} units)`);
    }

    console.log("\n✅ Inventory creation completed!");
    console.log(`- ${createdInventory.length} inventory records created`);

    console.log("\n📊 Inventory Summary:");
    const dcInventory = createdInventory.filter(item => item.inventoryType === 'DC').length;
    const storeInventory = createdInventory.filter(item => item.inventoryType === 'STORE').length;
    console.log(`  • Distribution Center: ${dcInventory} items`);
    console.log(`  • Store Locations: ${storeInventory} items`);

    console.log("\n🏪 Store Distribution:");
    const store1Items = createdInventory.filter(item => item.storeId === 1).length;
    const store2Items = createdInventory.filter(item => item.storeId === 2).length;
    const store3Items = createdInventory.filter(item => item.storeId === 3).length;
    console.log(`  • Downtown Pet Store: ${store1Items} items`);
    console.log(`  • Suburban Pet Center: ${store2Items} items`);
    console.log(`  • Mall Pet Boutique: ${store3Items} items`);

  } catch (error) {
    console.error("❌ Error creating inventory:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedInventory();
