#!/usr/bin/env tsx

import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

async function checkStores() {
    console.log("Checking stores table for duplicates...");

    try {
        const result = await db.execute(sql`SELECT id, name, location, contact_info FROM stores ORDER BY name, id`);
        console.log("All stores in database:");
        console.log("ID\tName\t\t\t\tLocation\t\t\t\tContact Info");
        console.log("-".repeat(100));

        result.forEach((row: any) => {
            console.log(`${row.id}\t${row.name.padEnd(20)}\t${row.location.padEnd(30)}\t${row.contact_info}`);
        });

        // Check for duplicates by name
        console.log("\n🔍 Checking for duplicates by name...");
        const nameCounts = (result as any[]).reduce((acc, store) => {
            acc[store.name] = (acc[store.name] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const duplicates = Object.entries(nameCounts).filter(([name, count]) => (count as number) > 1);

        if (duplicates.length > 0) {
            console.log("❌ Found duplicate stores:");
            duplicates.forEach(([name, count]) => {
                console.log(`  • ${name}: ${count} copies`);
            });
        } else {
            console.log("✅ No duplicate stores found by name");
        }

        console.log(`\n📊 Total stores: ${(result as any[]).length}`);

    } catch (error) {
        console.error("Error checking stores:", error);
    }

    process.exit(0);
}

checkStores();
