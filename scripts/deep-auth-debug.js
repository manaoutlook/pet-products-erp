
// Deep authentication debugging script
import { config } from 'dotenv';
import axios from 'axios';
import pg from 'pg';
import crypto from 'crypto';
import { promisify } from 'util';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);

config();

async function deepAuthDebug() {
  console.log('=== DEEP AUTHENTICATION DEBUGGING ===');
  
  // Step 1: Check environment variables
  console.log('\n1. Checking environment variables...');
  const dbUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  const port = process.env.PORT || 3000;
  const baseUrl = `http://localhost:${port}`;
  
  console.log(`Database URL configured: ${dbUrl ? 'Yes' : 'No'}`);
  console.log(`Session secret configured: ${sessionSecret ? 'Yes' : 'No'}`);
  
  // Step 2: Test database connection
  console.log('\n2. Testing database connection...');
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is not set!');
    return;
  }
  
  const pool = new Pool({
    connectionString: dbUrl,
  });
  
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to database');
    
    // Step 3: Check user table
    console.log('\n3. Checking users table...');
    const usersResult = await client.query('SELECT id, username, password FROM users LIMIT 5');
    
    if (usersResult.rows.length === 0) {
      console.log('❌ No users found in the database');
    } else {
      console.log(`Found ${usersResult.rows.length} users`);
      
      // Check admin user
      const adminResult = await client.query("SELECT id, username, password FROM users WHERE username = 'admin'");
      if (adminResult.rows.length === 0) {
        console.log('❌ Admin user not found!');
      } else {
        const admin = adminResult.rows[0];
        console.log(`Admin user found (ID: ${admin.id})`);
        console.log(`Admin password hash length: ${admin.password.length}`);
        console.log(`Hash format check: ${admin.password.includes(':') ? 'Contains separator' : 'Missing separator'}`);
      }
    }
    
    // Step 4: Test API health check
    console.log('\n4. Testing API health check...');
    try {
      const healthResponse = await axios.get(`${baseUrl}/api/health`);
      console.log(`Health check status: ${healthResponse.status}`);
      console.log('Health check response:', healthResponse.data);
    } catch (error) {
      console.error(`❌ Health check failed: ${error.message}`);
      if (error.response) {
        console.log(`Status: ${error.response.status}`);
        console.log('Response:', error.response.data);
      }
    }
    
    // Step 5: Test login
    console.log('\n5. Testing login with admin credentials...');
    try {
      const loginResponse = await axios.post(`${baseUrl}/api/login`, {
        username: 'admin',
        password: 'admin123'
      }, {
        withCredentials: true
      });
      
      console.log(`Login status: ${loginResponse.status}`);
      console.log('Login response:', loginResponse.data);
      
      const cookies = loginResponse.headers['set-cookie'];
      console.log(`Cookies received: ${cookies ? 'Yes' : 'No'}`);
      if (cookies) {
        console.log('Cookie details:', cookies);
      }
      
      // Step 6: Test auth check after login
      if (loginResponse.status === 200) {
        console.log('\n6. Testing authentication after login...');
        try {
          const userResponse = await axios.get(`${baseUrl}/api/user`, {
            headers: {
              Cookie: cookies.join('; ')
            }
          });
          
          console.log(`Auth check status: ${userResponse.status}`);
          console.log('Auth check response:', userResponse.data);
        } catch (error) {
          console.error(`❌ Auth check failed: ${error.message}`);
          if (error.response) {
            console.log(`Status: ${error.response.status}`);
            console.log('Response:', error.response.data);
          }
        }
      }
      
    } catch (error) {
      console.error(`❌ Login failed: ${error.message}`);
      if (error.response) {
        console.log(`Status: ${error.response.status}`);
        console.log('Response:', error.response.data);
      }
    }
    
    client.release();
  } catch (error) {
    console.error(`❌ Database connection failed: ${error.message}`);
  } finally {
    pool.end();
  }
  
  console.log('\n=== DEBUGGING COMPLETE ===');
}

deepAuthDebug().catch(error => {
  console.error('Uncaught error in debugging script:', error);
});
