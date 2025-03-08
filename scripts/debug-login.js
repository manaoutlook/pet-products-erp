
// Login debugging script
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';

dotenv.config();
const { Client } = pg;

async function debugLogin() {
  console.log('Debugging login issues...');
  
  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    process.exit(1);
  }
  
  console.log(`Using DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database successfully');
    
    // Get admin user details
    const userQuery = await client.query(`
      SELECT u.*, r.permissions 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.username = 'admin'
    `);
    
    if (userQuery.rows.length === 0) {
      console.error('❌ Admin user not found!');
      return;
    }
    
    const adminUser = userQuery.rows[0];
    console.log('Admin user details:');
    console.log('- ID:', adminUser.id);
    console.log('- Username:', adminUser.username);
    console.log('- Role ID:', adminUser.role_id);
    
    // Check password hash format
    console.log('\nPassword hash check:');
    console.log('- Hash:', adminUser.password.substring(0, 10) + '...');
    console.log('- Length:', adminUser.password.length);
    console.log('- Contains dot separator:', adminUser.password.includes('.'));
    console.log('- Appears to be bcrypt:', adminUser.password.startsWith('$2'));
    
    // Test default password
    const testPassword = 'admin123';
    try {
      const passwordMatches = await bcrypt.compare(testPassword, adminUser.password);
      console.log(`\nDefault password '${testPassword}' matches: ${passwordMatches ? '✅ YES' : '❌ NO'}`);
    } catch (err) {
      console.error('❌ Password comparison error:', err.message);
    }
    
    // Check permissions
    console.log('\nPermissions check:');
    console.log(adminUser.permissions);
    
  } catch (err) {
    console.error('Database query error:', err);
  } finally {
    await client.end();
  }
}

debugLogin().catch(console.error);
