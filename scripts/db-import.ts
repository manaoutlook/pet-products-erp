import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { 
  roles, users, stores, brands, categories,
  products, suppliers, inventory, customerProfiles 
} from "../db/schema";  // Remove .ts/.js extension for better TypeScript/ESM compatibility

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load .env from the project root with explicit path
dotenv.config({ path: path.join(projectRoot, '.env') });

// Log the DATABASE_URL to debug
console.log("Database URL is set:", !!process.env.DATABASE_URL);

// Helper function to convert string timestamps to Date objects
function convertDates(obj: any) {
  const result = { ...obj };
  for (const key in result) {
    if (key === 'createdAt' || key === 'updatedAt' || key.includes('Date')) {
      if (result[key] && typeof result[key] === 'string') {
        result[key] = new Date(result[key]);
      }
    }
  }
  return result;
}

async function importDatabase() {
  const client = postgres(process.env.DATABASE_URL!);

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be set");
    }

    const db = drizzle(client, {
      schema: { roles, users, stores, brands, categories, products, suppliers, inventory, customerProfiles }
    });

    // Read the dump file from project root
    const dumpPath = path.join(projectRoot, 'database_dump.json');
    const dumpData = JSON.parse(
      await fs.promises.readFile(dumpPath, 'utf8')
    );

    // Import data in the correct order based on foreign key dependencies
    console.log('Importing roles...');
    for (const role of dumpData.roles) {
      // Create a modified role object
      const roleToInsert = { ...convertDates(role) };
      
      try {
        // First try inserting with the original data structure
        await db.insert(roles).values(roleToInsert).onConflictDoNothing();
      } catch (error) {
        // If there's an error about role_location_id
        if (error.message && error.message.includes('role_location_id')) {
          console.log(`Adapting role ${role.id} to match schema structure...`);
          
          // Option 1: If roleLocationId exists in the data but not in the DB
          if (roleToInsert.roleLocationId !== undefined) {
            delete roleToInsert.roleLocationId;
          }
          
          // Option 2: If role_location_id is required in the DB but missing in data
          if (error.message.includes('violates not-null constraint') && roleToInsert.roleLocationId === undefined) {
            roleToInsert.roleLocationId = 1; // Default value
          }
          
          // Try again with the modified object
          await db.insert(roles).values(roleToInsert).onConflictDoNothing();
        } else {
          // If it's a different error, throw it
          throw error;
        }
      }
    }

    console.log('Importing users...');
    for (const user of dumpData.users) {
      await db.insert(users).values(convertDates(user)).onConflictDoNothing();
    }

    console.log('Importing stores...');
    for (const store of dumpData.stores) {
      await db.insert(stores).values(convertDates(store)).onConflictDoNothing();
    }

    console.log('Importing brands...');
    for (const brand of dumpData.brands) {
      await db.insert(brands).values(convertDates(brand)).onConflictDoNothing();
    }

    console.log('Importing categories...');
    for (const category of dumpData.categories) {
      await db.insert(categories).values(convertDates(category)).onConflictDoNothing();
    }

    console.log('Importing products...');
    for (const product of dumpData.products) {
      await db.insert(products).values(convertDates(product)).onConflictDoNothing();
    }

    console.log('Importing suppliers...');
    for (const supplier of dumpData.suppliers) {
      await db.insert(suppliers).values(convertDates(supplier)).onConflictDoNothing();
    }

    console.log('Importing inventory...');
    for (const item of dumpData.inventory) {
      await db.insert(inventory).values(convertDates(item)).onConflictDoNothing();
    }

    console.log('Importing customer profiles...');
    for (const profile of dumpData.customerProfiles) {
      await db.insert(customerProfiles).values(convertDates(profile)).onConflictDoNothing();
    }

    console.log('Database import completed successfully');
  } catch (error) {
    console.error('Error importing database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

importDatabase();