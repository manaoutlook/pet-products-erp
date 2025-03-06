import { drizzle } from "drizzle-orm/neon-serverless";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ws from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Import schema directly from TypeScript file
const schemaPath = path.join(projectRoot, 'db', 'schema.ts');
const schema = await import(schemaPath);

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
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be set");
    }

    const db = drizzle({
      connection: process.env.DATABASE_URL,
      schema,
      ws: ws,
    });

    // Read the dump file from project root
    const dumpPath = path.join(projectRoot, 'database_dump.json');
    const dumpData = JSON.parse(
      await fs.promises.readFile(dumpPath, 'utf8')
    );

    // Import data in the correct order based on foreign key dependencies
    console.log('Importing roles...');
    for (const role of dumpData.roles) {
      await db.insert(schema.roles).values(convertDates(role)).onConflictDoNothing();
    }

    console.log('Importing users...');
    for (const user of dumpData.users) {
      await db.insert(schema.users).values(convertDates(user)).onConflictDoNothing();
    }

    console.log('Importing stores...');
    for (const store of dumpData.stores) {
      await db.insert(schema.stores).values(convertDates(store)).onConflictDoNothing();
    }

    console.log('Importing brands...');
    for (const brand of dumpData.brands) {
      await db.insert(schema.brands).values(convertDates(brand)).onConflictDoNothing();
    }

    console.log('Importing categories...');
    for (const category of dumpData.categories) {
      await db.insert(schema.categories).values(convertDates(category)).onConflictDoNothing();
    }

    console.log('Importing products...');
    for (const product of dumpData.products) {
      await db.insert(schema.products).values(convertDates(product)).onConflictDoNothing();
    }

    console.log('Importing suppliers...');
    for (const supplier of dumpData.suppliers) {
      await db.insert(schema.suppliers).values(convertDates(supplier)).onConflictDoNothing();
    }

    console.log('Importing inventory...');
    for (const item of dumpData.inventory) {
      await db.insert(schema.inventory).values(convertDates(item)).onConflictDoNothing();
    }

    console.log('Importing customer profiles...');
    for (const profile of dumpData.customerProfiles) {
      await db.insert(schema.customerProfiles).values(convertDates(profile)).onConflictDoNothing();
    }

    console.log('Database import completed successfully');
  } catch (error) {
    console.error('Error importing database:', error);
    process.exit(1);
  }
}

importDatabase();