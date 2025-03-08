
// Debug script for authentication issues
const fetch = require('node-fetch');

const BASE_URL = process.env.APP_URL || 'http://localhost:5000';
const username = 'admin';
const password = 'admin123';

async function debugLogin() {
  console.log('=== Authentication Debug Script ===');
  console.log(`Testing login at ${BASE_URL}/api/login`);
  console.log(`Using credentials: username=${username}, password=******`);
  
  try {
    // 1. Check DB connection first
    console.log('\n1. Testing database connection via health check...');
    const healthResponse = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthResponse.json();
    console.log('Health check response:', healthData);
    
    if (healthData.database !== 'connected') {
      console.error('DATABASE CONNECTION ISSUE DETECTED');
      console.log('Database URL configured:', process.env.DATABASE_URL ? 'Yes' : 'No');
      console.log('Please check your DATABASE_URL environment variable');
      return;
    }
    
    // 2. Attempt login
    console.log('\n2. Attempting login...');
    const loginResponse = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        password
      })
    });
    
    const loginStatus = loginResponse.status;
    console.log('Login status code:', loginStatus);
    
    let responseBody;
    try {
      responseBody = await loginResponse.json();
      console.log('Login response body:', responseBody);
    } catch (e) {
      console.log('Login response is not JSON:', await loginResponse.text());
    }
    
    if (loginStatus !== 200) {
      console.error('LOGIN FAILED');
      if (loginStatus === 500) {
        console.log('\nINTERNAL SERVER ERROR DETECTED. Possible causes:');
        console.log('- Database connection issues');
        console.log('- Password hash format issues');
        console.log('- Server-side exception during authentication');
      }
    } else {
      console.log('LOGIN SUCCESSFUL');
    }
  } catch (e) {
    console.error('Error during debug:', e);
  }
}

debugLogin().catch(console.error);
