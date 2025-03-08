
// Admin password reset script (CommonJS version)
require('dotenv').config();
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const crypto = require("crypto");

console.log("Database URL check:", process.env.DATABASE_URL ? "Found" : "Not found");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Use PostgreSQL connection string with postgres-js
const queryClient = postgres(process.env.DATABASE_URL, { max: 10 });

// Setup DB with direct SQL approach
const db = {
  query: async (sql, params = []) => {
    try {
      console.log(`Executing SQL: ${sql}`);
      const result = await queryClient.unsafe(sql, params);
      console.log(`Query returned ${result.length} rows`);
      return result;
    } catch (error) {
      console.error('SQL Error:', error.message);
      throw error;
    }
  }
};

// Simple crypto implementation
const hashPassword = async (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

async function resetAdminPassword() {
  console.log('Starting admin password reset process...');
  
  try {
    // First, check if we can connect to the database
    console.log('Testing database connection...');
    await db.query('SELECT 1 as test');
    console.log('Database connection successful');
    
    // Check if admin user exists
    console.log('Checking for admin user...');
    const adminUsers = await db.query("SELECT * FROM users WHERE username = 'admin'");
    
    if (!adminUsers || adminUsers.length === 0) {
      console.log('Admin user not found, creating new admin user...');
      
      // Check if admin role exists
      const adminRoles = await db.query("SELECT * FROM roles WHERE name = 'admin'");
      
      if (!adminRoles || adminRoles.length === 0) {
        console.error('Admin role not found, cannot create admin user');
        return;
      }
      
      const adminRole = adminRoles[0];
      console.log('Found admin role with ID:', adminRole.id);
      
      // Hash new admin password
      const hashedPassword = await hashPassword('admin123');
      
      // Create admin user
      await db.query(
        `INSERT INTO users (username, password, role_id, created_at, updated_at) 
         VALUES ('admin', $1, $2, NOW(), NOW())`,
        [hashedPassword, adminRole.id]
      );
      
      console.log('Created new admin user with username: admin and password: admin123');
    } else {
      console.log('Found existing admin user, resetting password...');
      const adminUser = adminUsers[0];
      
      // Hash new admin password
      const hashedPassword = await hashPassword('admin123');
      
      // Update admin password
      await db.query(
        `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
        [hashedPassword, adminUser.id]
      );
      
      console.log('Admin password reset to "admin123"');
    }
    
    console.log('Admin password reset complete');
  } catch (error) {
    console.error('Error resetting admin password:', error);
  } finally {
    // Close DB connection
    await queryClient.end();
    process.exit(0);
  }
}

resetAdminPassword();
