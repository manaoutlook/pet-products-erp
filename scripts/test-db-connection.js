
// Database connection test script
// Run with: node scripts/test-db-connection.js

const { Client } = require('pg');

async function testConnection() {
  console.log('Testing database connection...');
  
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    console.log('Please set the DATABASE_URL environment variable to connect to your database.');
    process.exit(1);
  }
  
  console.log(`Using DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('✅ Successfully connected to the database!');
    
    console.log('\nRunning test query...');
    const res = await client.query('SELECT count(*) FROM users');
    console.log(`Found ${res.rows[0].count} users in the database.`);
    
    console.log('\nTesting admin user query...');
    const adminResult = await client.query("SELECT id, username, role_id FROM users WHERE username = 'admin'");
    if (adminResult.rows.length > 0) {
      console.log('✅ Admin user found:', adminResult.rows[0]);
    } else {
      console.error('❌ Admin user not found in the database!');
    }
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    console.error('Error details:', err);
  } finally {
    await client.end();
  }
}

testConnection().catch(console.error);
