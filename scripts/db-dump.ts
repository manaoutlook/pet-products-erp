import { db } from "@db";
import fs from "fs";
import path from "path";

async function dumpDatabase() {
  try {
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

    // Write to a JSON file
    const dumpPath = path.join(process.cwd(), 'database_dump.json');
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
