import "dotenv/config";
import { db } from "../db/index.js";
import { stores, userStoreAssignments, regions, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function seedStoresDemo() {
  console.log("🏪 Seeding Stores and User Assignments...");

  try {
    // First, get the correct region IDs by querying the regions table
    console.log("\n📍 Step 1: Getting region information...");
    const allRegions = await db.query.regions.findMany({
      orderBy: [regions.name]
    });

    console.log("Available regions:");
    allRegions.forEach(region => {
      console.log(`  ${region.name} (ID: ${region.id})`);
    });

    // Map region names to IDs
    const regionMap: { [key: string]: number } = {};
    allRegions.forEach(region => {
      regionMap[region.name] = region.id;
    });

    // Step 2: Create stores with correct region IDs
    console.log("\n📍 Step 2: Creating Stores");
    const storesData = [
      // Retail stores
      {
        name: "Downtown Pet Store",
        regionId: regionMap["South Zone"], // South Zone (HCMC area)
        type: "RETAIL",
        location: "123 Main Street, Downtown District",
        contactInfo: "Phone: (555) 111-2222 | Email: downtown@pets.com"
      },
      {
        name: "Suburban Pet Center",
        regionId: regionMap["South Zone"], // South Zone (HCMC area)
        type: "RETAIL",
        location: "456 Oak Avenue, Suburban Plaza",
        contactInfo: "Phone: (555) 333-4444 | Email: suburban@pets.com"
      },
      {
        name: "Mall Pet Boutique",
        regionId: regionMap["North Zone"], // North Zone (Hanoi area)
        type: "RETAIL",
        location: "789 Shopping Mall, Level 2",
        contactInfo: "Phone: (555) 555-6666 | Email: mall@pets.com"
      },
      // Distribution Centers (Warehouses)
      {
        name: "HCMC Distribution Center",
        regionId: regionMap["South Zone"], // South Zone
        type: "WAREHOUSE",
        location: "Industrial Zone, Ho Chi Minh City",
        contactInfo: "Phone: (555) 777-8888 | Email: hcmc.dc@pets.com"
      },
      {
        name: "Hanoi Distribution Center",
        regionId: regionMap["North Zone"], // North Zone
        type: "WAREHOUSE",
        location: "Logistics Park, Hanoi",
        contactInfo: "Phone: (555) 999-0000 | Email: hanoi.dc@pets.com"
      },
      {
        name: "Hoi An Distribution Center",
        regionId: regionMap["East Zone"], // East Zone (Central Vietnam)
        type: "WAREHOUSE",
        location: "Port Area, Hoi An",
        contactInfo: "Phone: (555) 222-3333 | Email: hoian.dc@pets.com"
      }
    ];

    const createdStores = [];
    for (const store of storesData) {
      // Check if store already exists
      const existingStore = await db.query.stores.findFirst({
        where: eq(stores.name, store.name)
      });

      if (existingStore) {
        console.log(`✓ Store already exists: ${store.name} (ID: ${existingStore.id})`);
        createdStores.push(existingStore);
      } else {
        const result = await db.insert(stores).values(store).returning();
        createdStores.push(result[0]);
        console.log(`✓ Created store: ${store.name} (ID: ${result[0].id})`);
      }
    }

    // Step 3: Create user-store assignments
    console.log("\n👥 Step 3: Creating User-Store Assignments");

    // Get admin user by username instead of hardcoded ID
    const adminUser = await db.query.users.findFirst({
      where: eq(users.username, 'admin')
    });

    let assignments: any[] = [];
    if (!adminUser) {
      console.log("⚠️  Admin user not found. Skipping user assignments.");
    } else {
      console.log(`Note: Admin user (${adminUser.username}, ID: ${adminUser.id}) will be assigned to all stores`);

      assignments = [];
      for (const store of createdStores) {
        // Check if assignment already exists
        const existingAssignment = await db.query.userStoreAssignments.findFirst({
          where: eq(userStoreAssignments.userId, adminUser.id) && eq(userStoreAssignments.storeId, store.id)
        });

        if (existingAssignment) {
          console.log(`✓ Assignment already exists: ${adminUser.username} -> ${store.name}`);
          assignments.push(existingAssignment);
        } else {
          const assignment = await db.insert(userStoreAssignments).values({
            userId: adminUser.id,
            storeId: store.id
          }).returning();

          assignments.push(assignment[0]);
          console.log(`✓ Assigned ${adminUser.username} to store: ${store.name} (Assignment ID: ${assignment[0].id})`);
        }
      }
    }

    // Step 3: Demonstrate the relationships
    console.log("\n🔗 Step 3: Demonstrating Relationships");

    // Query stores with their assignments
    const storesWithAssignments = await db
      .select()
      .from(stores)
      .leftJoin(userStoreAssignments, eq(userStoreAssignments.storeId, stores.id))
      .where(eq(userStoreAssignments.userId, 1));

    console.log("📊 Stores assigned to admin user:");
    for (const row of storesWithAssignments) {
      console.log(`  - ${row.stores.name} (${row.stores.location})`);
    }

    console.log("\n✅ Store creation and assignment demo completed!");
    console.log("\n📋 Summary:");
    console.log(`- ${createdStores.length} stores created`);
    console.log(`- ${assignments.length} user-store assignments created`);
    console.log("- Admin user assigned to all stores");
    console.log("\n🔑 Key Points:");
    console.log("- Stores table: Contains store information (name, location, contact)");
    console.log("- User Store Assignments table: Links users to stores (many-to-many)");
    console.log("- One user can be assigned to multiple stores");
    console.log("- One store can have multiple users assigned");
    console.log("- This enables role-based access control per store");

  } catch (error) {
    console.error("❌ Error in store demo:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedStoresDemo();
