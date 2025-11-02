import pg from 'pg';

const { Client } = pg;

async function createDatabase() {
  // Connect to default postgres database to create our database
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'admin123',
    database: 'postgres'
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    // Create the database if it doesn't exist
    await client.query('CREATE DATABASE "pet-erp"');
    console.log('Database "pet-erp" created successfully');

  } catch (error) {
    if (error.code === '42P04') {
      console.log('Database "pet-erp" already exists');
    } else {
      console.error('Error creating database:', error);
      throw error;
    }
  } finally {
    await client.end();
  }
}

createDatabase().catch(console.error);
