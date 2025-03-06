import { drizzle } from "drizzle-orm/neon-serverless";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ws from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Import schema from the correct path
import * as schema from "../db/schema.js";

async function dumpDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be set");
    }

    const db = drizzle({
      connection: process.env.DATABASE_URL,
      schema,
      ws: ws,
    });

    // Fetch all data from each table
    const roles = await db.query.roles.findMany();
    const users = await db.query.users.findMany();
    const stores = await db.query.stores.findMany();
    const brands = await db.query.brands.findMany();
    const categories = await db.query.categories.findMany();
    const products = await db.query.products.findMany();
    const suppliers = await db.query.suppliers.findMany();
    const inventory = await db.query.inventory.findMany();
    const customerProfiles = await db.query.customerProfiles.findMany();

    const dumpData = {
      roles,
      users,
      stores,
      brands,
      categories,
      products,
      suppliers,
      inventory,
      customerProfiles,
    };

    // Write to a JSON file in the project root
    const dumpPath = path.join(projectRoot, 'database_dump.json');
    await fs.promises.writeFile(
      dumpPath,
      JSON.stringify(dumpData, null, 2),
      'utf8'
    );

    console.log(`Database dump created successfully at ${dumpPath}`);
  } catch (error) {
    console.error('Error dumping database:', error);
    process.exit(1);
  }
}

dumpDatabase();