import "dotenv/config";
import { db } from "../db/index.js";
import { roles } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function updateAdminPermissions() {
  console.log("🔧 Updating admin role permissions to include stores...");

  try {
    const [updatedRole] = await db
      .update(roles)
      .set({
        permissions: {
          products: { create: true, read: true, update: true, delete: true },
          orders: { create: true, read: true, update: true, delete: true },
          inventory: { create: true, read: true, update: true, delete: true },
          users: { create: true, read: true, update: true, delete: true },
          stores: { create: true, read: true, update: true, delete: true }
        },
        updatedAt: new Date()
      })
      .where(eq(roles.name, 'admin'))
      .returning();

    if (updatedRole) {
      console.log("✅ Admin role permissions updated successfully!");
      console.log("New permissions:", updatedRole.permissions);
    } else {
      console.log("❌ Admin role not found");
    }

  } catch (error) {
    console.error("❌ Error updating admin permissions:", error);
    process.exit(1);
  }

  process.exit(0);
}

updateAdminPermissions();
