import { db } from "../db/index";
import { inventory } from "../db/schema";
import { isNull } from "drizzle-orm";

async function main() {
    const dcInventory = await db.select().from(inventory).where(isNull(inventory.storeId));
    console.log(`Inventory records with storeId=null (DC): ${dcInventory.length}`);
    if (dcInventory.length > 0) {
        console.log("Sample records:");
        console.table(dcInventory.slice(0, 5));
    }
}

main().catch(console.error);
