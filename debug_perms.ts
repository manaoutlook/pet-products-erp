
import { db } from "./db/index";
import { users, roles } from "./db/schema";
import { eq } from "drizzle-orm";

async function check() {
    const user = await db.query.users.findFirst({
        where: eq(users.username, "anna_inventory"),
        with: { role: true }
    });

    if (user) {
        console.log("USER:", user.username);
        console.log("ROLE:", user.role.name);
        console.log("PERMISSIONS TYPE:", typeof user.role.permissions);
        console.log("PERMISSIONS KEYS:", Object.keys(user.role.permissions));
        console.log("TRANSFERS PERM:", JSON.stringify(user.role.permissions.inventoryTransfer, null, 2));
    } else {
        console.log("User not found");
    }
}

check().catch(console.error).finally(() => process.exit());
