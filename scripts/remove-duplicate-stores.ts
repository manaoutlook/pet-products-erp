#!/usr/bin/env tsx

import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

async function removeDuplicateStores() {
    console.log("🧹 Removing duplicate stores...");

    try {
        // First, let's identify the duplicate stores to keep and delete
        const result = await db.execute(sql`
            SELECT id, name, location, contact_info
            FROM stores
            ORDER BY name, id
        `);

        console.log("Current stores:");
        (result as any[]).forEach((store) => {
            console.log(`ID ${store.id}: ${store.name}`);
        });

        // Group by name and keep the lowest ID for each unique store
        const storesByName = (result as any[]).reduce((acc, store) => {
            if (!acc[store.name]) {
                acc[store.name] = [];
            }
            acc[store.name].push(store);
            return acc;
        }, {} as Record<string, any[]>);

        const storesToDelete: number[] = [];

        (Object.entries(storesByName) as [string, any[]][]).forEach(([name, stores]) => {
            if (stores.length > 1) {
                // Sort by ID and keep the first one (lowest ID)
                const sortedStores = stores.sort((a: any, b: any) => a.id - b.id);
                const keepStore = sortedStores[0];
                const deleteStores = sortedStores.slice(1);

                console.log(`\n📋 ${name}:`);
                console.log(`  ✅ Keep: ID ${keepStore.id}`);
                deleteStores.forEach((store: any) => {
                    console.log(`  🗑️  Delete: ID ${store.id}`);
                    storesToDelete.push(store.id);
                });
            }
        });

        if (storesToDelete.length === 0) {
            console.log("\n✅ No duplicate stores found!");
            return;
        }

        console.log(`\n🗑️  Will delete ${storesToDelete.length} duplicate stores: IDs ${storesToDelete.join(', ')}`);

        // Create mapping of stores to keep and their duplicates
        const storeMapping: Record<number, number> = {};
        (Object.entries(storesByName) as [string, any[]][]).forEach(([name, stores]) => {
            if (stores.length > 1) {
                const sortedStores = stores.sort((a: any, b: any) => a.id - b.id);
                const keepStore = sortedStores[0];
                const deleteStores = sortedStores.slice(1);

                deleteStores.forEach((store: any) => {
                    storeMapping[store.id] = keepStore.id;
                });
            }
        });

        // Update foreign key references first
        console.log("\n🔄 Updating foreign key references...");

        const tablesToUpdate = [
            'inventory',
            'orders',
            'user_store_assignments',
            'invoice_counters',
            'sales_transactions',
            'transfer_requests' // has from_store_id and to_store_id
        ];

        for (const tableName of tablesToUpdate) {
            for (const [oldStoreId, newStoreId] of Object.entries(storeMapping)) {
                if (tableName === 'transfer_requests') {
                    // Special handling for transfer_requests which has both from_store_id and to_store_id
                    const fromCountResult = await db.execute(sql`
                        SELECT COUNT(*) as count
                        FROM transfer_requests
                        WHERE from_store_id = ${oldStoreId}
                    `);
                    const fromCount = parseInt((fromCountResult[0] as any).count);

                    const toCountResult = await db.execute(sql`
                        SELECT COUNT(*) as count
                        FROM transfer_requests
                        WHERE to_store_id = ${oldStoreId}
                    `);
                    const toCount = parseInt((toCountResult[0] as any).count);

                    if (fromCount > 0) {
                        console.log(`📝 Updating ${fromCount} records in transfer_requests (from_store_id): Store ID ${oldStoreId} → ${newStoreId}`);
                        await db.execute(sql`
                            UPDATE transfer_requests
                            SET from_store_id = ${newStoreId}
                            WHERE from_store_id = ${oldStoreId}
                        `);
                    }

                    if (toCount > 0) {
                        console.log(`📝 Updating ${toCount} records in transfer_requests (to_store_id): Store ID ${oldStoreId} → ${newStoreId}`);
                        await db.execute(sql`
                            UPDATE transfer_requests
                            SET to_store_id = ${newStoreId}
                            WHERE to_store_id = ${oldStoreId}
                        `);
                    }
                } else {
                    // Regular table with store_id column
                    const countResult = await db.execute(sql`
                        SELECT COUNT(*) as count
                        FROM ${sql.identifier(tableName)}
                        WHERE store_id = ${oldStoreId}
                    `);
                    const count = parseInt((countResult[0] as any).count);

                    if (count > 0) {
                        console.log(`📝 Updating ${count} records in ${tableName}: Store ID ${oldStoreId} → ${newStoreId}`);
                        await db.execute(sql`
                            UPDATE ${sql.identifier(tableName)}
                            SET store_id = ${newStoreId}
                            WHERE store_id = ${oldStoreId}
                        `);
                    }
                }
            }
        }

        console.log(`\n🗑️  Ready to delete ${storesToDelete.length} duplicate stores`);

        // Delete the duplicate stores
        for (const storeId of storesToDelete) {
            await db.execute(sql`DELETE FROM stores WHERE id = ${storeId}`);
            console.log(`✅ Deleted duplicate store ID ${storeId}`);
        }

        console.log("\n✅ Duplicate store removal completed!");

        // Show final result
        const finalResult = await db.execute(sql`SELECT id, name FROM stores ORDER BY id`);
        console.log("\n📊 Final stores list:");
        (finalResult as any[]).forEach((store) => {
            console.log(`ID ${store.id}: ${store.name}`);
        });
        console.log(`\n📈 Total unique stores: ${(finalResult as any[]).length}`);

    } catch (error) {
        console.error("❌ Error removing duplicate stores:", error);
        process.exit(1);
    }

    process.exit(0);
}

removeDuplicateStores();
