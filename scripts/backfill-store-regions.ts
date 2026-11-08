import "dotenv/config";
import { db } from "../db/index.js";
import { stores, regions } from "../db/schema.js";
import { eq, isNull, asc } from "drizzle-orm";

/**
 * Backfills stores that were created before region assignment was enforced
 * through the UI (their region_id is NULL).
 *
 * Target region resolution order:
 *   1. BACKFILL_REGION_ID   (numeric id)
 *   2. BACKFILL_REGION_NAME (exact region name, e.g. "South Zone")
 *   3. The first region by id (lowest id) as a safe fallback
 *
 * Run with:  npx tsx scripts/backfill-store-regions.ts
 * Override:  BACKFILL_REGION_NAME="South Zone" npx tsx scripts/backfill-store-regions.ts
 */
async function backfillStoreRegions() {
  console.log("🛠️  Backfilling stores with missing region_id...");

  try {
    const storesWithoutRegion = await db.query.stores.findMany({
      where: isNull(stores.regionId),
      orderBy: [asc(stores.id)],
    });

    if (storesWithoutRegion.length === 0) {
      console.log("✅ No stores with NULL region_id found. Nothing to do.");
      process.exit(0);
    }

    console.log(`Found ${storesWithoutRegion.length} store(s) without a region:`);
    storesWithoutRegion.forEach((store) => {
      console.log(`  • [${store.id}] ${store.name} (${store.type})`);
    });

    const allRegions = await db.query.regions.findMany({
      orderBy: [asc(regions.id)],
    });

    if (allRegions.length === 0) {
      console.error("❌ No regions exist. Create a region first, then re-run this script.");
      process.exit(1);
    }

    const envId = process.env.BACKFILL_REGION_ID
      ? parseInt(process.env.BACKFILL_REGION_ID, 10)
      : undefined;
    const envName = process.env.BACKFILL_REGION_NAME;

    let target = allRegions[0];
    if (envId !== undefined && !Number.isNaN(envId)) {
      const match = allRegions.find((region) => region.id === envId);
      if (!match) {
        console.error(`❌ No region with id ${envId}. Available regions:`);
        allRegions.forEach((region) => console.error(`   [${region.id}] ${region.name}`));
        process.exit(1);
      }
      target = match;
    } else if (envName) {
      const match = allRegions.find((region) => region.name === envName);
      if (!match) {
        console.error(`❌ No region named "${envName}". Available regions:`);
        allRegions.forEach((region) => console.error(`   [${region.id}] ${region.name}`));
        process.exit(1);
      }
      target = match;
    }

    console.log(`\n📍 Assigning all stores above to region: [${target.id}] ${target.name}`);

    for (const store of storesWithoutRegion) {
      await db
        .update(stores)
        .set({ regionId: target.id, updatedAt: new Date() })
        .where(eq(stores.id, store.id));
      console.log(`  ✓ ${store.name} -> region ${target.id} (${target.name})`);
    }

    console.log(`\n✅ Backfilled ${storesWithoutRegion.length} store(s) to region "${target.name}".`);
  } catch (error) {
    console.error("❌ Error backfilling store regions:", error);
    process.exit(1);
  }

  process.exit(0);
}

backfillStoreRegions();
