import "dotenv/config";
import { db } from "../db/index.js";
import { regions } from "../db/schema.js";

async function seedRegions() {
  console.log("🗺️ Seeding regions...");

  try {
    const regionsData = [
      {
        name: "North Zone",
        description: "Northern region covering Hanoi and surrounding areas"
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

    console.log("📍 Inserting regions...");
    for (const region of regionsData) {
      const result = await db.insert(regions).values(region).returning();
      console.log(`✓ Inserted region: ${region.name} (ID: ${result[0].id})`);
    }

    console.log("✅ Regions seeding completed successfully!");
    console.log("\n📊 Summary:");
    console.log("- 4 Regions inserted");
    console.log("  • North Zone");
    console.log("  • South Zone");
    console.log("  • West Zone");
    console.log("  • East Zone");

  } catch (error) {
    console.error("❌ Error seeding regions:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedRegions();
