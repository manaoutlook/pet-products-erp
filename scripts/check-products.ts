#!/usr/bin/env tsx

import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

async function checkProducts() {
    console.log("Checking products table...");

    try {
        const result = await db.execute(sql`SELECT id, name, sku FROM products ORDER BY id LIMIT 10`);
        console.log("Products in database:");
        result.forEach((row: any) => {
            console.log(`ID: ${row.id}, Name: ${row.name}, SKU: ${row.sku}`);
        });

        const count = await db.execute(sql`SELECT COUNT(*) as count FROM products`);
        console.log(`\nTotal products: ${(count[0] as any).count}`);

    } catch (error) {
        console.error("Error checking products:", error);
    }

    process.exit(0);
}

checkProducts();
