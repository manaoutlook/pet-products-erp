
// Debug login with detailed tracing
require('dotenv').config();
const { Client } = require('pg');
const axios = require('axios');
const util = require('util');
const crypto = require('crypto');
const scryptAsync = util.promisify(crypto.scrypt);

async function verifyPasswordHash(password, storedPassword) {
  try {
    // Split stored password into hash and salt
    const parts = storedPassword.split(".");
    if (parts.length !== 2) {
      return { 
        isValid: false, 
        reason: `Invalid stored password format: ${parts.length} parts found, expected 2` 
      };
    }
    
    const [storedHash, salt] = parts;
    if (!storedHash || !salt) {
      return {
        isValid: false,
        reason: 'Missing hash or salt component'
      };
    }

    // Generate hash from supplied password and stored salt
    const derivedKey = await scryptAsync(password, salt, 64);
    const suppliedHash = derivedKey.toString("hex");

    // Compare
    const isMatch = storedHash === suppliedHash;
    
    return {
      isValid: isMatch,
      storedHashLength: storedHash.length,
      suppliedHashLength: suppliedHash.length,
      saltLength: salt.length,
      passwordLength: password.length,
      reason: isMatch ? 'Hash match' : 'Hash mismatch'
    };
  } catch (error) {
    return {
      isValid: false,
      reason: `Error verifying: ${error.message}`
    };
  }
}

async function testApiLogin() {
  try {
    // Basic endpoint test
    console.log('\nTesting API health...');
    const healthResponse = await axios.get('http://localhost:5002/api/health', {
      validateStatus: () => true
    });
    console.log(`Health endpoint status: ${healthResponse.status}`);
    console.log('Health response:', healthResponse.data);
    
    // Test login endpoint
    console.log('\nTesting login endpoint...');
    const loginResponse = await axios.post('http://localhost:5002/api/login', {
      username: 'admin',
      password: 'admin123'
    }, {
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Login endpoint status: ${loginResponse.status}`);
    console.log('Login response:', loginResponse.data);
    
    return {
      healthStatus: healthResponse.status,
      loginStatus: loginResponse.status,
      loginData: loginResponse.data
    };
  } catch (error) {
    console.error('API test error:', error.message);
    return {
      error: error.message,
      healthStatus: error.response?.status || 'connection failed',
      loginStatus: error.response?.status || 'connection failed'
    };
  }
}

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
      SELECT u.*, r.id as role_id, r.name as role_name, r.permissions 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.username = 'admin'
    `);
    
    if (userQuery.rows.length === 0) {
      console.error('❌ Admin user not found!');
      return;
    }
    
    const adminUser = userQuery.rows[0];
    console.log('\nAdmin user details:');
    console.log('- ID:', adminUser.id);
    console.log('- Username:', adminUser.username);
    console.log('- Role ID:', adminUser.role_id);
    console.log('- Role Name:', adminUser.role_name);
    
    // Check password hash format
    console.log('\nPassword hash check:');
    const passwordHash = adminUser.password;
    console.log('- Full hash:', passwordHash);
    console.log('- Length:', passwordHash.length);
    console.log('- Contains dot separator:', passwordHash.includes('.'));
    
    if (passwordHash.includes('.')) {
      const [hash, salt] = passwordHash.split('.');
      console.log('- Hash part length:', hash.length);
      console.log('- Salt part length:', salt.length);
    }
    
    // Test password verification
    console.log('\nVerifying password hash against "admin123"...');
    const verification = await verifyPasswordHash('admin123', passwordHash);
    console.log('Verification result:', verification);
    
    if (verification.isValid) {
      console.log('✅ Password "admin123" is valid against the stored hash');
    } else {
      console.log('❌ Password "admin123" is NOT valid against the stored hash');
      console.log('Reason:', verification.reason);
    }
    
    // Test API login
    console.log('\n========== TESTING API LOGIN ==========');
    const apiTest = await testApiLogin();
    
    // Overall diagnosis
    console.log('\n========== DIAGNOSIS ==========');
    if (verification.isValid && apiTest.loginStatus === 200) {
      console.log('✅ Authentication system is working correctly');
    } else if (verification.isValid && apiTest.loginStatus !== 200) {
      console.log('❌ Password hash is valid but API login failed');
      console.log('Likely causes:');
      console.log('1. Session handling or cookie issues');
      console.log('2. API middleware error');
      console.log('3. Server configuration issue');
    } else {
      console.log('❌ Password hash validation failed');
      console.log('Likely causes:');
      console.log('1. Incorrect password hashing implementation');
      console.log('2. Database corruption');
    }
    
  } catch (err) {
    console.error('Error debugging login:', err);
  } finally {
    await client.end();
  }
}

debugLogin().catch(console.error);
