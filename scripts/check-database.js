
const { Pool } = require('pg');

// Get the database URL from command line or environment
const databaseUrl = process.argv[2] || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required. Please provide it as an environment variable or command-line argument:');
  console.error('Usage: node scripts/check-database.js "postgresql://username:password@localhost:5432/database"');
  process.exit(1);
}

console.log('Testing database connection...');

const pool = new Pool({
  connectionString: databaseUrl,
});

pool.query('SELECT 1 as connection_test')
  .then(result => {
    console.log('✅ Database connection successful!');
    console.log('Connection details:');
    
    // Parse connection string to show details (without password)
    try {
      const urlObj = new URL(databaseUrl);
      console.log(`- Host: ${urlObj.hostname}`);
      console.log(`- Port: ${urlObj.port}`);
      console.log(`- Database: ${urlObj.pathname.replace('/', '')}`);
      console.log(`- User: ${urlObj.username}`);
      console.log(`- SSL: ${databaseUrl.includes('ssl=true') ? 'Enabled' : 'Not specified'}`);
    } catch (e) {
      console.log('Could not parse connection details from URL');
    }
    
    pool.end();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    console.error('Please check your connection string and ensure the database server is running.');
    pool.end();
    process.exit(1);
  });
