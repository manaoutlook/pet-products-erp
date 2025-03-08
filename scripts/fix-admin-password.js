
// Fix admin password script
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

async function fixAdminPassword() {
  console.log('Fixing admin password...');
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    process.exit(1);
  }
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Generate properly formatted bcrypt hash for 'admin123'
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    
    console.log('Generated new password hash');
    
    // Update admin password
    const updateResult = await client.query(
      "UPDATE users SET password = $1 WHERE username = 'admin' RETURNING id, username",
      [hashedPassword]
    );
    
    if (updateResult.rows.length > 0) {
      console.log(`✅ Successfully updated password for user: ${updateResult.rows[0].username} (ID: ${updateResult.rows[0].id})`);
    } else {
      console.error('❌ Admin user not found or password not updated');
    }
    
  } catch (err) {
    console.error('Error fixing admin password:', err);
  } finally {
    await client.end();
  }
}

fixAdminPassword().catch(console.error);
