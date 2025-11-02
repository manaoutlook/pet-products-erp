import { db } from "../db/index.js";
import { stores, userStoreAssignments } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function seedStoresDemo() {
  console.log("🏪 Demonstrating Store Creation and User Assignments...");

  try {
    // Step 1: Create stores
    console.log("\n📍 Step 1: Creating Stores");
    const storesData = [
      {
        name: "Downtown Pet Store",
        location: "123 Main Street, Downtown District",
        contactInfo: "Phone: (555) 111-2222 | Email: downtown@pets.com"
      },
      {
        name: "Suburban Pet Center",
        location: "456 Oak Avenue, Suburban Plaza",
        contactInfo: "Phone: (555) 333-4444 | Email: suburban@pets.com"
      },
      {
        name: "Mall Pet Boutique",
        location: "789 Shopping Mall, Level 2",
        contactInfo: "Phone: (555) 555-6666 | Email: mall@pets.com"
      }
    ];

    const createdStores = [];
    for (const store of storesData) {
      const result = await db.insert(stores).values(store).returning();
      createdStores.push(result[0]);
      console.log(`✓ Created store: ${store.name} (ID: ${result[0].id})`);
    }

    // Step 2: Create user-store assignments
    console.log("\n👥 Step 2: Creating User-Store Assignments");
    console.log("Note: Admin user (ID: 1) will be assigned to all stores");

    const assignments = [];
    for (const store of createdStores) {
      const assignment = await db.insert(userStoreAssignments).values({
        userId: 1, // Admin user
        storeId: store.id
      }).returning();

      assignments.push(assignment[0]);
      console.log(`✓ Assigned admin user to store: ${store.name} (Assignment ID: ${assignment[0].id})`);
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
