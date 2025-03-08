
// Debug Express session and auth issues
import { config } from 'dotenv';
import axios from 'axios';

config();

async function debugSession() {
  console.log('Debugging session and authentication issues...');
  
  try {
    const baseUrl = 'http://localhost:5002';
    const cookieJar = {};
    
    // Helper function to store cookies from responses
    const storeCookies = (response) => {
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader) {
        setCookieHeader.forEach(cookie => {
          const [keyValue] = cookie.split(';');
          const [key, value] = keyValue.split('=');
          cookieJar[key] = value;
        });
      }
      return Object.entries(cookieJar).map(([key, value]) => `${key}=${value}`).join('; ');
    };
    
    // Test 1: Health check
    console.log('\nStep 1: Testing API health...');
    const healthResponse = await axios.get(`${baseUrl}/api/health`, {
      validateStatus: () => true
    });
    console.log(`Health check status: ${healthResponse.status}`);
    console.log('Response:', healthResponse.data);
    
    // Test 2: Attempt login
    console.log('\nStep 2: Testing login...');
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
        validateStatus: () => true,
        withCredentials: true
      }
    );
    
    console.log(`Login status: ${loginResponse.status}`);
    console.log('Login response:', loginResponse.data);
    
    // Check and store cookies
    console.log('\nCookies received:');
    const cookies = storeCookies(loginResponse);
    console.log(cookies || 'No cookies received');
    
    if (!cookies) {
      console.log('❌ No session cookie was set - this indicates a session setup issue');
    }
    
    // Test 3: Get user info with session
    console.log('\nStep 3: Testing user session...');
    const userResponse = await axios.get(
      `${baseUrl}/api/user`,
      {
        headers: {
          Cookie: cookies
        },
        validateStatus: () => true,
        withCredentials: true
      }
    );
    
    console.log(`User info status: ${userResponse.status}`);
    console.log('User info response:', userResponse.data);
    
    // Diagnose issues
    console.log('\n========== DIAGNOSIS ==========');
    
    if (loginResponse.status === 500) {
      console.log('❌ Server error during login');
      console.log('Likely causes:');
      console.log('1. Error in password comparison logic');
      console.log('2. Database query error');
      console.log('3. Session initialization error');
    } else if (loginResponse.status === 200 && userResponse.status !== 200) {
      console.log('❌ Login successful but session not maintained');
      console.log('Likely causes:');
      console.log('1. Session configuration issue');
      console.log('2. Cookie not being set correctly');
      console.log('3. Cookie not being sent in subsequent requests');
    } else if (loginResponse.status === 400) {
      console.log('❌ Login credentials rejected');
      console.log('Likely causes:');
      console.log('1. Incorrect password hashing comparison');
      console.log('2. Username/password mismatch');
    } else if (loginResponse.status === 200 && userResponse.status === 200) {
      console.log('✅ Authentication and session working correctly');
    }
    
  } catch (error) {
    console.error('Error during debugging:', error.message);
  }
}

debugSession().catch(console.error);
