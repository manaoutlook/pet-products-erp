
// Script to fix admin password using the same crypto implementation as auth.ts
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';
import pg from 'pg';

const { Pool } = pg;
const scryptAsync = promisify(scrypt);

// Recreate the crypto functions from auth.ts
const crypto = {
  hash: async (password) => {
    try {
      if (!password) {
        throw new Error('Password is required');
      }

      const salt = randomBytes(16).toString("hex");
      console.log(`Generating hash for password with salt: ${salt}`);

      const derivedKey = await scryptAsync(password, salt, 64);
      const hashedPassword = `${derivedKey.toString("hex")}.${salt}`;

      console.log(`Successfully generated password hash. Length: ${hashedPassword.length}`);
      return hashedPassword;
    } catch (error) {
      console.error('Error in password hashing:', error);
      throw new Error('Failed to secure password. Please try again.');
    }
  }
};

// Self-executing async function
(async () => {
  try {
    console.log("Starting admin password reset...");
    
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL environment variable is not set.');
      console.log('Please set the DATABASE_URL environment variable and try again.');
      process.exit(1);
    }
    
    console.log(`Using DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
    
    // Generate hash for 'admin123'
    const hashedPassword = await crypto.hash('admin123');
    console.log(`Generated new password hash for 'admin123'`);
    
    // Connect to the database
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    
    console.log("Connecting to database...");
    const client = await pool.connect();
    
    try {
      console.log("Updating admin password in database...");
      // Update the admin user's password
      const result = await client.query(
        "UPDATE users SET password = $1 WHERE username = 'admin' RETURNING id, username",
        [hashedPassword]
      );
      
      if (result.rows.length > 0) {
        console.log(`✅ Successfully updated password for user: ${result.rows[0].username} (ID: ${result.rows[0].id})`);
        console.log("The admin password has been reset to 'admin123'");
      } else {
        console.error("❌ Admin user not found in database");
      }
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error resetting admin password:', error);
    process.exit(1);
  }
})();
