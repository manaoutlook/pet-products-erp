import 'dotenv/config';
import { db } from "../db/index.js";
import { stores, inventory, purchaseOrders } from "../db/schema.js";
import { eq, isNull } from "drizzle-orm";

async function migrateMultipleDC() {
    console.log("🚀 Starting Multiple Distribution Center Migration...");

    try {
        // 1. Update all existing stores to 'RETAIL'
        console.log("Updating existing stores to 'RETAIL'...");
        await db.update(stores).set({ type: 'RETAIL' });

        // 2. Create the first official Warehouse (Distribution Center)
        console.log("Creating Main Distribution Center...");
        const [mainDC] = await db.insert(stores).values({
            name: "Main Distribution Center",
            type: "WAREHOUSE",
            location: "Central Warehouse District",
            contactInfo: "warehouse@example.com",
        }).returning();

        console.log(`✓ Created Main DC with ID: ${mainDC.id}`);

        // 3. Migrate existing DC inventory (where storeId is null or inventoryType is 'DC')
        console.log("Migrating existing DC inventory to the new Warehouse...");
        const result = await db.update(inventory)
            .set({
                storeId: mainDC.id,
                inventoryType: 'STORE' // Since it's now attached to a 'store' (which is a Warehouse)
            })
            .where(eq(inventory.inventoryType, 'DC'));

        console.log("✓ Migrated inventory items to Warehouse.");

        // 4. Update existing Purchase Orders to point to the Main DC
        console.log("Updating existing Purchase Orders to point to Main DC...");
        await db.update(purchaseOrders).set({ destinationStoreId: mainDC.id });

        console.log("✓ Updated Purchase Orders.");

        console.log("\n✅ Migration completed successfully!");
        console.log(`Summary: All existing stock previously tagged as 'DC' is now managed by '${mainDC.name}' (ID: ${mainDC.id}).`);

    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }

    process.exit(0);
}

migrateMultipleDC();
