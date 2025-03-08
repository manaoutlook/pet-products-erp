
// Fix session authentication issues
import { config } from 'dotenv';
import pg from 'pg';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

config();
const { Pool } = pg;
const scryptAsync = promisify(scrypt);

// Improved crypto functions for password handling
const crypto = {
  hash: async (password) => {
    try {
      const salt = randomBytes(16).toString("hex");
      console.log(`Using salt: ${salt} (length: ${salt.length})`);
      
      const derivedKey = (await scryptAsync(password, salt, 64));
      const hashedPassword = `${derivedKey.toString("hex")}.${salt}`;
      
      console.log(`Generated hash with length: ${hashedPassword.length}`);
      console.log(`Hash and salt separator at position: ${hashedPassword.indexOf('.')}`);
      
      return hashedPassword;
    } catch (error) {
      console.error('Error hashing password:', error);
      throw error;
    }
  },
};

async function fixSessionAuth() {
  console.log('Starting session auth fix...');
  
  try {
    // Create database connection
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    console.log('Connecting to database...');
    await pool.query('SELECT 1');
    console.log('✅ Connected to database');

    // Get admin user details
    const result = await pool.query(`
      SELECT u.id, u.username, u.password, r.name as role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.username = 'admin'
    `);

    if (result.rows.length === 0) {
      console.error('Admin user not found');
      return;
    }

    const adminUser = result.rows[0];
    console.log(`Found admin user (ID: ${adminUser.id})`);

    // Reset admin password to 'admin123'
    const newPasswordHash = await crypto.hash('admin123');
    
    console.log('Updating admin password...');
    const updateResult = await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username',
      [newPasswordHash, adminUser.id]
    );

    console.log('Admin password updated successfully');
    console.log('Updated user:', updateResult.rows[0]);
    console.log('New hash length:', newPasswordHash.length);
    console.log('Hash contains separator:', newPasswordHash.includes('.'));

    console.log('\nSession authentication fix complete!');
    console.log('Please restart the server and try logging in again.');
  } catch (error) {
    console.error('Error fixing session auth:', error);
  }
}

fixSessionAuth().catch(console.error);
