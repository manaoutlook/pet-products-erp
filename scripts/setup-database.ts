import "dotenv/config";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";

async function setupDatabase() {
  console.log("🚀 Setting up Pet Products ERP Database...");

  try {
    // Test database connection
    console.log("\n📡 Testing database connection...");
    await db.execute(sql`SELECT 1`);
    console.log("✅ Database connection successful");

    // Push database schema
    console.log("\n🗃️  Pushing database schema...");
    try {
      execSync("npx drizzle-kit push", { stdio: "inherit" });
      console.log("✅ Database schema pushed successfully");
    } catch (error) {
      console.log("⚠️  Schema push may have failed, but continuing...");
    }

    // Seed basic data
    console.log("\n🌱 Seeding basic data...");

    // Run seed scripts in order using execSync
    const seedScripts = [
      "seed-users-roles.ts",
      "seed-stores-demo.ts",
      "seed-products.ts",
      "seed-sample-data.ts"
    ];

    for (const script of seedScripts) {
      console.log(`Running ${script}...`);
      try {
        execSync(`npx tsx scripts/${script}`, { stdio: "inherit" });
        console.log(`✅ ${script} completed`);
      } catch (error) {
        console.log(`⚠️  ${script} may have failed, but continuing...`);
      }
    }

    console.log("\n✅ Database setup completed successfully!");
    console.log("\n📋 Next steps:");
    console.log("1. Start the application: npm run dev");
    console.log("2. Open http://localhost:5000 in your browser");
    console.log("3. Login with admin / admin123");

  } catch (error) {
    console.error("❌ Database setup failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

setupDatabase();
