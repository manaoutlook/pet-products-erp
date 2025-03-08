
// Test admin login
import fetch from 'node-fetch';

async function testAdminLogin() {
  console.log('Testing admin login...');
  
  const BASE_URL = process.env.APP_URL || 'http://localhost:5001';
  
  try {
    // Attempt login
    console.log(`Trying to login at ${BASE_URL}/api/login`);
    const response = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    });
    
    const status = response.status;
    console.log(`Login status: ${status}`);
    
    let data;
    try {
      data = await response.json();
    } catch (e) {
      data = await response.text();
    }
    
    console.log('Login response:', data);
    
    if (status === 200) {
      console.log('✅ LOGIN SUCCESSFUL!');
    } else {
      console.log('❌ Login failed');
    }
  } catch (error) {
    console.error('Error testing login:', error);
  }
}

testAdminLogin();
