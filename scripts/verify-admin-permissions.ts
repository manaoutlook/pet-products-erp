import "dotenv/config";
import { db } from "../db/index.js";
import { roles } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function verifyAdminPermissions() {
  console.log("🔍 Verifying admin role permissions...");

  try {
    const adminRole = await db.select().from(roles).where(eq(roles.name, 'admin')).limit(1);

    if (adminRole.length > 0) {
      console.log("✅ Admin role found");
      console.log("Current permissions:");
      console.log(JSON.stringify(adminRole[0].permissions, null, 2));
    } else {
      console.log("❌ Admin role not found");
    }

  } catch (error) {
    console.error("❌ Error verifying admin permissions:", error);
    process.exit(1);
  }

  process.exit(0);
}

verifyAdminPermissions();
