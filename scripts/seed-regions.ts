import "dotenv/config";
import { db } from "../db/index.js";
import { regions, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function seedRegions() {
  console.log("🗺️ Seeding regions...");

  try {
    // Try to get the regional manager user (may not exist yet on first run)
    const regionalManager = await db.query.users.findFirst({
      where: eq(users.username, 'regional_boss'),
    });

    const regionsData = [
      {
        name: "North Zone",
        description: "Northern region covering Hanoi and surrounding areas",
        managerUserId: regionalManager ? regionalManager.id : null
      },
      {
        name: "South Zone",
        description: "Southern region covering Ho Chi Minh City and surrounding areas"
      },
      {
        name: "West Zone",
        description: "Western region covering Can Tho and Mekong Delta areas"
      },
      {
        name: "East Zone",
        description: "Eastern region covering Da Nang and central coastal areas"
      }
    ];

    if (!regionalManager) {
      console.log("ℹ️  Regional manager user not found. Skipping manager assignment (can be assigned later).");
    }

    console.log("📍 Inserting regions...");
    for (const region of regionsData) {
      const result = await db.insert(regions).values(region).returning();
      console.log(`✓ Inserted region: ${region.name} (ID: ${result[0].id})`);
    }

    console.log("✅ Regions seeding completed successfully!");
    console.log("\n📊 Summary:");
    console.log("- 4 Regions inserted");
    console.log("  • North Zone (Managed by regional_boss)");
    console.log("  • South Zone");
    console.log("  • West Zone");
    console.log("  • East Zone");
    console.log("\n👤 Regional Manager Assignment:");
    console.log(`  • regional_boss manages North Zone`);

  } catch (error) {
    console.error("❌ Error seeding regions:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedRegions();
