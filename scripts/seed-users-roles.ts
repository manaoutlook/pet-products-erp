import { db } from "../db/index.js";
import { roles, users, userStoreAssignments } from "../db/schema.js";

async function seedUsersAndRoles() {
  console.log("👥 Creating Users and Roles...");

  try {
    // Step 1: Create 5 different roles with varying permissions
    console.log("\n🔐 Step 1: Creating Roles");

    const rolesData = [
      {
        name: "store_manager",
        description: "Store Manager - Full access to their assigned stores",
        isSystemAdmin: false,
        permissions: {
          products: { create: true, read: true, update: true, delete: false },
          orders: { create: true, read: true, update: true, delete: false },
          inventory: { create: true, read: true, update: true, delete: false },
          users: { create: false, read: true, update: false, delete: false },
          stores: { create: false, read: true, update: false, delete: false },
          masterData: { create: false, read: true, update: false, delete: false },
          pos: { create: true, read: true, update: true, delete: false },
          receipts: { create: true, read: true, update: true, delete: false }
        }
      },
      {
        name: "sales_associate",
        description: "Sales Associate - Can create orders and view products",
        isSystemAdmin: false,
        permissions: {
          products: { create: false, read: true, update: false, delete: false },
          orders: { create: true, read: true, update: true, delete: false },
          inventory: { create: false, read: true, update: false, delete: false },
          users: { create: false, read: false, update: false, delete: false },
          stores: { create: false, read: true, update: false, delete: false },
          masterData: { create: false, read: true, update: false, delete: false },
          pos: { create: true, read: true, update: true, delete: false },
          receipts: { create: true, read: true, update: true, delete: false }
        }
      },
      {
        name: "inventory_clerk",
        description: "Inventory Clerk - Manages stock and suppliers",
        isSystemAdmin: false,
        permissions: {
          products: { create: false, read: true, update: false, delete: false },
          orders: { create: false, read: false, update: false, delete: false },
          inventory: { create: true, read: true, update: true, delete: false },
          users: { create: false, read: false, update: false, delete: false },
          stores: { create: false, read: true, update: false, delete: false },
          masterData: { create: true, read: true, update: true, delete: false },
          pos: { create: false, read: true, update: false, delete: false },
          receipts: { create: false, read: true, update: false, delete: false }
        }
      },
      {
        name: "customer_service",
        description: "Customer Service - Handles customer inquiries and profiles",
        isSystemAdmin: false,
        permissions: {
          products: { create: false, read: true, update: false, delete: false },
          orders: { create: false, read: true, update: false, delete: false },
          inventory: { create: false, read: true, update: false, delete: false },
          users: { create: false, read: false, update: false, delete: false },
          stores: { create: false, read: true, update: false, delete: false },
          masterData: { create: false, read: true, update: false, delete: false },
          pos: { create: false, read: true, update: false, delete: false },
          receipts: { create: true, read: true, update: false, delete: false }
        }
      },
      {
        name: "regional_manager",
        description: "Regional Manager - Oversees multiple stores",
        isSystemAdmin: false,
        permissions: {
          products: { create: true, read: true, update: true, delete: true },
          orders: { create: true, read: true, update: true, delete: true },
          inventory: { create: true, read: true, update: true, delete: true },
          users: { create: true, read: true, update: true, delete: false },
          stores: { create: true, read: true, update: true, delete: false },
          masterData: { create: true, read: true, update: true, delete: true },
          pos: { create: true, read: true, update: true, delete: true },
          receipts: { create: true, read: true, update: true, delete: true }
        }
      }
    ];

    const createdRoles: any[] = [];
    for (const role of rolesData) {
      const result = await db.insert(roles).values(role as any).returning();
      createdRoles.push(result[0]);
      console.log(`✓ Created role: ${role.name} (${role.description})`);
    }

    // Step 2: Create 10 users with different roles
    console.log("\n👤 Step 2: Creating Users");

    const usersData = [
      { username: "john_manager", roleId: createdRoles[0].id }, // store_manager
      { username: "sarah_manager", roleId: createdRoles[0].id }, // store_manager
      { username: "mike_sales", roleId: createdRoles[1].id }, // sales_associate
      { username: "lisa_sales", roleId: createdRoles[1].id }, // sales_associate
      { username: "david_sales", roleId: createdRoles[1].id }, // sales_associate
      { username: "anna_inventory", roleId: createdRoles[2].id }, // inventory_clerk
      { username: "tom_inventory", roleId: createdRoles[2].id }, // inventory_clerk
      { username: "jane_service", roleId: createdRoles[3].id }, // customer_service
      { username: "mark_service", roleId: createdRoles[3].id }, // customer_service
      { username: "regional_boss", roleId: createdRoles[4].id } // regional_manager
    ];

    const createdUsers: any[] = [];
    for (const user of usersData) {
      // Hash password (using 'password123' for all demo users)
      // Note: Using the same scrypt logic as server/auth.ts
      const { scrypt, randomBytes } = await import("crypto");
      const { promisify } = await import("util");
      const scryptAsync = promisify(scrypt);

      const salt = randomBytes(16).toString("hex");
      const derivedKey = (await scryptAsync('password123', salt, 64)) as Buffer;
      const hashedPassword = `${derivedKey.toString("hex")}.${salt}`;

      const result = await db.insert(users).values({
        ...user,
        password: hashedPassword
      }).returning();

      createdUsers.push(result[0]);
      console.log(`✓ Created user: ${user.username} (Role: ${createdRoles.find(r => r.id === user.roleId)?.name})`);
    }

    // Step 3: Assign users to stores (demonstrating multi-store access)
    console.log("\n🏪 Step 3: Assigning Users to Stores");

    const storeAssignments = [
      // Store managers - each manages one store
      { userId: createdUsers[0].id, storeId: 1 }, // john_manager -> Downtown Pet Store
      { userId: createdUsers[1].id, storeId: 2 }, // sarah_manager -> Suburban Pet Center

      // Sales associates - distributed across stores
      { userId: createdUsers[2].id, storeId: 1 }, // mike_sales -> Downtown
      { userId: createdUsers[3].id, storeId: 2 }, // lisa_sales -> Suburban
      { userId: createdUsers[4].id, storeId: 3 }, // david_sales -> Mall

      // Inventory clerks - work at multiple stores
      { userId: createdUsers[5].id, storeId: 1 }, // anna_inventory -> Downtown
      { userId: createdUsers[5].id, storeId: 2 }, // anna_inventory -> Suburban (multi-store)
      { userId: createdUsers[6].id, storeId: 3 }, // tom_inventory -> Mall

      // Customer service - can access all stores
      { userId: createdUsers[7].id, storeId: 1 }, // jane_service -> Downtown
      { userId: createdUsers[7].id, storeId: 2 }, // jane_service -> Suburban
      { userId: createdUsers[7].id, storeId: 3 }, // jane_service -> Mall
      { userId: createdUsers[8].id, storeId: 1 }, // mark_service -> Downtown
      { userId: createdUsers[8].id, storeId: 2 }, // mark_service -> Suburban

      // Regional manager - access to all stores
      { userId: createdUsers[9].id, storeId: 1 }, // regional_boss -> Downtown
      { userId: createdUsers[9].id, storeId: 2 }, // regional_boss -> Suburban
      { userId: createdUsers[9].id, storeId: 3 }  // regional_boss -> Mall
    ];

    for (const assignment of storeAssignments) {
      await db.insert(userStoreAssignments).values(assignment);
    }

    console.log("✓ Assigned users to stores with appropriate access levels");

    // Step 4: Summary
    console.log("\n✅ User and Role creation completed!");
    console.log("\n📊 Summary:");
    console.log(`- ${createdRoles.length} roles created`);
    console.log(`- ${createdUsers.length} users created`);
    console.log(`- ${storeAssignments.length} store assignments created`);

    console.log("\n👥 User Distribution by Role:");
    const roleCounts = createdUsers.reduce((acc, user) => {
      const roleName = createdRoles.find(r => r.id === user.roleId)?.name || 'unknown';
      acc[roleName] = (acc[roleName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(roleCounts).forEach(([role, count]) => {
      console.log(`  • ${role}: ${count} users`);
    });

    console.log("\n🔑 Login Credentials:");
    console.log("All users have password: password123");
    console.log("Admin user: admin / admin");
    createdUsers.forEach(user => {
      const roleName = createdRoles.find(r => r.id === user.roleId)?.name;
      console.log(`• ${user.username} / password123 (${roleName})`);
    });

  } catch (error) {
    console.error("❌ Error creating users and roles:", error);
    process.exit(1);
  }

  process.exit(0);
}

seedUsersAndRoles();
