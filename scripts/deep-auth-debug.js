
// Deep authentication debugging script
const { config } = require('dotenv');
const axios = require('axios');
const { Pool } = require('pg');
const { scrypt } = require('crypto');
const { promisify } = require('util');

config();
const scryptAsync = promisify(scrypt);

async function deepAuthDebug() {
  console.log('=== DEEP AUTHENTICATION DEBUGGING ===');
  
  try {
    // 1. Test database connection
    console.log('\n1. Testing database connection...');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    try {
      await pool.query('SELECT 1');
      console.log('✅ Database connection successful');
    } catch (dbError) {
      console.error('❌ Database connection failed:', dbError.message);
      return;
    }

    // 2. Validate admin user in database
    console.log('\n2. Checking admin user record...');
    try {
      const userResult = await pool.query(`
        SELECT u.id, u.username, u.password, r.name as role_name, r.id as role_id
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.username = 'admin'
      `);
      
      if (userResult.rows.length === 0) {
        console.error('❌ Admin user not found in database');
        return;
      }
      
      const adminUser = userResult.rows[0];
      console.log('✅ Found admin user:', {
        id: adminUser.id,
        username: adminUser.username,
        roleId: adminUser.role_id,
        roleName: adminUser.role_name,
      });
      
      // 3. Check password hash format
      console.log('\n3. Validating password hash format...');
      const passwordHash = adminUser.password;
      console.log(`Hash: ${passwordHash.substring(0, 10)}...`);
      console.log(`Hash length: ${passwordHash.length}`);
      const hasSeparator = passwordHash.includes('.');
      console.log(`Contains separator: ${hasSeparator}`);
      
      if (!hasSeparator) {
        console.error('❌ Password hash missing separator!');
      } else {
        const [hash, salt] = passwordHash.split('.');
        console.log(`Hash part length: ${hash.length}`);
        console.log(`Salt part length: ${salt.length}`);
        
        if (hash.length < 32 || salt.length < 8) {
          console.error('❌ Hash or salt component too short!');
        } else {
          console.log('✅ Password hash appears to be in correct format');
        }
      }
    } catch (userError) {
      console.error('❌ Error checking admin user:', userError.message);
    }

    // 4. Test login API endpoint
    console.log('\n4. Testing login API endpoint...');
    const baseUrl = 'http://localhost:5002';
    
    try {
      const loginResponse = await axios.post(
        `${baseUrl}/api/login`,
        {
          username: 'admin',
          password: 'admin123'
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          validateStatus: () => true
        }
      );
      
      console.log(`Login API status: ${loginResponse.status}`);
      console.log(`Login response:`, loginResponse.data);
      
      if (loginResponse.status === 200) {
        console.log('✅ Login successful!');
      } else if (loginResponse.status === 500) {
        console.error('❌ Server error during login');
        console.log('Login Error:', loginResponse.data);
      } else {
        console.warn('⚠️ Login returned non-success status:', loginResponse.status);
      }
      
      // Check if cookie was set
      const setCookieHeader = loginResponse.headers['set-cookie'];
      if (setCookieHeader && setCookieHeader.length > 0) {
        console.log('✅ Session cookie was set:', setCookieHeader[0].split(';')[0]);
      } else {
        console.error('❌ No session cookie was set');
      }
    } catch (apiError) {
      console.error('❌ Error testing login API:', apiError.message);
    }

    console.log('\n=== DEBUGGING COMPLETED ===');
  } catch (error) {
    console.error('Error during debugging:', error);
  }
}

deepAuthDebug().catch(console.error);
