
#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'http://0.0.0.0:5000';
const username = 'admin';
const password = 'admin123';

async function testLoginEndpoint() {
  console.log('=== Login Endpoint Test ===');
  console.log(`Testing login at ${BASE_URL}/api/login`);
  
  try {
    // 1. Test health endpoint
    console.log('\n1. Testing health endpoint...');
    const healthResponse = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthResponse.json();
    console.log('Health endpoint status:', healthResponse.status);
    console.log('Health endpoint response:', healthData);
    
    // 2. Test login endpoint
    console.log('\n2. Testing login endpoint...');
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
    
    console.log('Login status code:', loginResponse.status);
    
    try {
      const loginData = await loginResponse.json();
      console.log('Login response:', loginData);
      
      if (loginResponse.status === 200) {
        console.log('\n✅ LOGIN SUCCESSFUL');
      } else {
        console.log('\n❌ LOGIN FAILED');
      }
    } catch (e) {
      console.log('Login response is not JSON:', await loginResponse.text());
    }
    
  } catch (error) {
    console.error('Error during test:', error);
  }
}

testLoginEndpoint().catch(console.error);
