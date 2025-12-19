#!/usr/bin/env tsx

import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

// List of all tables to check
const tables = [
    'role_types',
    'roles',
    'users',
    'stores',
    'user_store_assignments',
    'brands',
    'suppliers',
    'categories',
    'products',
    'inventory',
    'orders',
    'order_items',
    'purchase_orders',
    'purchase_order_items',
    'purchase_order_actions',
    'customer_profiles',
    'invoice_counters',
    'sales_transactions',
    'sales_transaction_items',
    'sales_transaction_actions',
    'transfer_requests',
    'transfer_request_items',
    'transfer_actions',
    'transfer_history'
];

async function checkTableData() {
    console.log("Checking data in all tables...\n");

    for (const tableName of tables) {
        try {
            const result = await db.execute(sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}`);
            const count = parseInt((result[0] as any).count);
            const status = count > 0 ? `✅ Has data (${count} records)` : `❌ Empty (0 records)`;
            console.log(`${tableName.padEnd(25)}: ${status}`);
        } catch (error) {
            console.log(`${tableName.padEnd(25)}: ❌ Error checking table - ${(error as Error).message}`);
        }
    }

    console.log("\nData check completed.");
}

checkTableData().catch(console.error);
