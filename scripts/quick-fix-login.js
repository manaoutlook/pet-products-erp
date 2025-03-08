
// Quick login fix verification script
import pg from 'pg';
import fetch from 'node-fetch';

const { Pool } = pg;

async function quickFixLogin() {
  console.log('Running quick login fix...');
  
  try {
    // 1. Verify server is running
    console.log('1. Checking server status...');
    const ports = [5001, 5002, 5003];
    let activePort = null;
    
    for (const port of ports) {
      try {
        const response = await fetch(`http://localhost:${port}/api/health`, { 
          method: 'GET',
          timeout: 2000
        });
        if (response.ok) {
          activePort = port;
          console.log(`✅ Server is running on port ${port}`);
          break;
        }
      } catch (err) {
        console.log(`Server not running on port ${port}`);
      }
    }
    
    if (!activePort) {
      console.log('❌ Could not find active server - make sure the server is running');
      return;
    }
    
    // 2. Try login with direct approach
    console.log(`\n2. Testing login on port ${activePort}...`);
    const loginResponse = await fetch(`http://localhost:${activePort}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    });
    
    const loginData = await loginResponse.json();
    console.log(`Login status: ${loginResponse.status}`);
    console.log('Login response:', loginData);
    
    if (loginResponse.status === 200) {
      console.log('✅ Login successful! The fix is working.');
    } else {
      console.log('❌ Login still failing. Additional troubleshooting needed.');
      console.log('Try restarting the server with: npm run dev');
    }
    
  } catch (error) {
    console.error('Error in quick fix login test:', error.message);
  }
}

quickFixLogin().catch(console.error);
