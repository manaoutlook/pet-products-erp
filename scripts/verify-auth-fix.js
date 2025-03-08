
// Verify authentication fix
import { config } from 'dotenv';
import axios from 'axios';

config();

async function verifyAuthFix() {
  console.log('Verifying authentication fix...');
  
  const baseUrl = 'http://localhost:5002'; // Use your app port
  const cookieJar = {};
  
  try {
    // Test 1: Health check
    console.log('\nStep 1: Testing API health...');
    const healthResponse = await axios.get(`${baseUrl}/api/health`, {
      validateStatus: () => true
    });
    console.log(`Health check status: ${healthResponse.status}`);
    
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
        validateStatus: () => true
      }
    );
    
    console.log(`Login status: ${loginResponse.status}`);
    if (loginResponse.status === 200) {
      console.log('✅ Login successful');
      console.log('Login response:', loginResponse.data);
    } else {
      console.log('❌ Login failed');
      console.log('Login response:', loginResponse.data);
    }
    
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
    
    // Check and store cookies
    const cookies = storeCookies(loginResponse);
    console.log('\nCookies received:', cookies || 'No cookies received');

  } catch (error) {
    console.error('Error during verification:', error.message);
  }
}

verifyAuthFix().catch(console.error);
