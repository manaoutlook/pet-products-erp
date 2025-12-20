import { db } from "../db/index";
import { stores } from "../db/schema";

async function main() {
    const allStores = await db.select().from(stores);
    console.log("Current Stores in Database:");
    console.table(allStores);
}

main().catch(console.error);
