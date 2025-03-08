
// Admin password reset script (CommonJS version)
require('dotenv').config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const { eq } = require("drizzle-orm");
const crypto = require("crypto");

console.log("Database URL check:", process.env.DATABASE_URL ? "Found" : "Not found");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Use PostgreSQL connection string with postgres-js
const queryClient = postgres(process.env.DATABASE_URL, { max: 10 });

// Load schema manually for CommonJS
const schema = {
  users: {
    id: { name: 'id' },
    username: { name: 'username' },
    password: { name: 'password' },
    roleId: { name: 'role_id' },
    createdAt: { name: 'created_at' },
    updatedAt: { name: 'updated_at' }
  },
  roles: {
    id: { name: 'id' },
    name: { name: 'name' },
    description: { name: 'description' },
    roleTypeId: { name: 'role_type_id' },
    permissions: { name: 'permissions' },
    createdAt: { name: 'created_at' },
    updatedAt: { name: 'updated_at' }
  }
};

const db = drizzle(queryClient, { schema });

// Simple crypto implementation
const hashPassword = async (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

async function resetAdminPassword() {
  console.log('Starting admin password reset process...');
  
  try {
    // Get admin user using raw SQL since we don't have the full schema
    const adminUserResult = await db.execute(
      `SELECT * FROM users WHERE username = 'admin'`
    );
    const adminUser = adminUserResult.rows[0];
    
    if (!adminUser) {
      console.log('Admin user not found, creating new admin user...');
      
      // Get admin role using raw SQL
      const adminRoleResult = await db.execute(
        `SELECT * FROM roles WHERE name = 'admin'`
      );
      const adminRole = adminRoleResult.rows[0];
      
      if (!adminRole) {
        console.error('Admin role not found, cannot create admin user');
        return;
      }
      
      // Hash new admin password
      const hashedPassword = await hashPassword('admin123');
      
      // Create admin user with raw SQL
      const newUserResult = await db.execute(
        `INSERT INTO users (username, password, role_id, created_at, updated_at) 
         VALUES ('admin', $1, $2, NOW(), NOW()) 
         RETURNING *`,
        [hashedPassword, adminRole.id]
      );
      const newUser = newUserResult.rows[0];
      
      console.log('Created new admin user with ID:', newUser.id);
    } else {
      console.log('Found existing admin user, resetting password...');
      
      // Hash new admin password
      const hashedPassword = await hashPassword('admin123');
      
      // Update admin password with raw SQL
      await db.execute(
        `UPDATE users 
         SET password = $1, updated_at = NOW() 
         WHERE id = $2`,
        [hashedPassword, adminUser.id]
      );
      
      console.log('Admin password reset to "admin123"');
    }
    
    console.log('Admin password reset complete');
  } catch (error) {
    console.error('Error resetting admin password:', error);
  } finally {
    process.exit(0);
  }
}

resetAdminPassword().catch(console.error);
