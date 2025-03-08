
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

// For direct database connection
import pg from 'pg';
const { Pool } = pg;

const scryptAsync = promisify(scrypt);

// Recreate the crypto functions from auth.ts
const crypto = {
  compare: async (suppliedPassword, storedPassword) => {
    try {
      console.log('Starting password comparison...');

      // Validate inputs
      if (!suppliedPassword || !storedPassword) {
        throw new Error('Both supplied and stored passwords are required');
      }

      // Split stored password into hash and salt
      const [storedHash, salt] = storedPassword.split(".");
      if (!storedHash || !salt) {
        console.error('Invalid stored password format:', { storedPassword });
        throw new Error('Invalid stored password format');
      }

      console.log('Generating hash with stored salt for comparison');
      const derivedKey = (await scryptAsync(suppliedPassword, salt, 64));
      const suppliedHash = derivedKey.toString("hex");

      // Compare hashes using timing-safe comparison
      const storedBuffer = Buffer.from(storedHash, "hex");
      const suppliedBuffer = Buffer.from(suppliedHash, "hex");

      console.log('Comparing password hashes...', {
        storedHashLength: storedHash.length,
        suppliedHashLength: suppliedHash.length
      });

      const isMatch = timingSafeEqual(storedBuffer, suppliedBuffer);
      console.log(`Password comparison result: ${isMatch}`);

      return isMatch;
    } catch (error) {
      console.error('Error comparing passwords:', error);
      if (error.message === 'Invalid stored password format') {
        throw error;
      }
      throw new Error('Error verifying password. Please try again.');
    }
  },
};

// Self-executing async function
(async () => {
  try {
    console.log("Starting admin account verification...");
    
    // Accept the DATABASE_URL from command line argument or environment variable
    const databaseUrl = process.argv[2] || process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      console.error("DATABASE_URL is not set. Please provide it as an environment variable or command-line argument:");
      console.error("Usage: node scripts/verify-admin.js <DATABASE_URL>");
      console.error("Or: DATABASE_URL=your_connection_string node scripts/verify-admin.js");
      process.exit(1);
    }
    
    // Connect to database
    const pool = new Pool({
      connectionString: databaseUrl,
    });
    
    // Get admin user from database
    console.log("Querying database for admin user...");
    const { rows } = await pool.query(`
      SELECT users.id, users.username, users.password, roles.name as role_name 
      FROM users 
      JOIN roles ON users.role_id = roles.id 
      WHERE users.username = 'admin'
    `);
    
    if (rows.length === 0) {
      console.error("Admin user not found in database!");
      process.exit(1);
    }
    
    const adminUser = rows[0];
    console.log("Found admin user with role:", adminUser.role_name);
    console.log("Password hash length:", adminUser.password.length);
    console.log("Password hash format:", adminUser.password.includes('.') ? 'Valid (contains separator)' : 'Invalid (missing separator)');
    
    if (!adminUser.password.includes('.')) {
      console.error("CRITICAL: Admin password hash is in invalid format (missing salt separator)");
      console.log("This will cause login failures. Please update the password using the update-admin-password.js script.");
    } else {
      // Try to verify if 'admin123' would work
      console.log("Testing if default password 'admin123' would authenticate...");
      const isMatch = await crypto.compare('admin123', adminUser.password);
      console.log(`Would 'admin123' work for login? ${isMatch ? 'YES' : 'NO'}`);
    }
    
    await pool.end();
    
  } catch (error) {
    console.error('Error verifying admin account:', error);
  }
})();
