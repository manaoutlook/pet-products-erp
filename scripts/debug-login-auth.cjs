
// Debug script for authentication issues
(async () => {
  // Use dynamic import for node-fetch
  const fetch = (await import('node-fetch')).default;

  // Use IP address format to ensure connectivity from containers/VMs
  const BASE_URL = process.env.APP_URL || 'http://0.0.0.0:5001';
  const username = 'admin';
  const password = 'admin123';

  // Test URL to check if we need to prepend /api
  console.log('Checking if server requires path prefix...');

  async function debugLogin() {
    console.log('=== Authentication Debug Script ===');
    console.log(`Testing login at ${BASE_URL}/api/login`);
    console.log(`Using credentials: username=${username}, password=******`);
    
    try {
      // 0. Check if we need path prefix adjustment
      console.log('\n0. Checking for correct API path structure...');
      let apiPrefix = '/api';
      let healthEndpoint = `${BASE_URL}${apiPrefix}/health`;
      
      try {
        // Try with /api prefix first
        console.log(`Trying health check at: ${healthEndpoint}`);
        const prefixResponse = await fetch(healthEndpoint, { timeout: 3000 });
        
        if (prefixResponse.status === 404) {
          // Try without /api prefix
          apiPrefix = '';
          healthEndpoint = `${BASE_URL}/health`;
          console.log(`404 received. Trying without /api prefix: ${healthEndpoint}`);
          const noApiResponse = await fetch(healthEndpoint, { timeout: 3000 });
          
          if (noApiResponse.status === 200) {
            console.log('Success! Server requires NO /api prefix');
          }
        } else if (prefixResponse.status === 200) {
          console.log('Success! Server requires /api prefix');
        }
      } catch (prefixError) {
        console.log(`Path detection error: ${prefixError.message}`);
        // Continue with default /api prefix
      }
      
      // 1. Check if server is running
      console.log('\n1. Testing server availability...');
      try {
        const serverResponse = await fetch(healthEndpoint, {
          timeout: 5000
        });
        console.log(`Server is responding with status: ${serverResponse.status}`);
        
        // Try to parse response as JSON
        let healthData;
        const contentType = serverResponse.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          healthData = await serverResponse.json();
          console.log('Health check response:', healthData);
          
          if (healthData.database !== 'connected') {
            console.error('DATABASE CONNECTION ISSUE DETECTED');
            console.log('Database URL configured:', healthData.databaseUrl || 'Unknown');
            console.log('Please check your DATABASE_URL environment variable');
            return;
          }
        } else {
          const text = await serverResponse.text();
          console.error('Server responded with non-JSON content:');
          console.log(`Content-Type: ${contentType}`);
          console.log(`Response (first 100 chars): ${text.substring(0, 100)}...`);
          console.log('\nPROBLEM DETECTED: Server is not returning JSON for health check');
          console.log('This suggests the server is not properly configured or not running correctly');
          return;
        }
      } catch (error) {
        console.error('ERROR CONNECTING TO SERVER:');
        console.error(error.message);
        console.log('\nPOSSIBLE CAUSES:');
        console.log('1. Server is not running');
        console.log('2. Server is running on a different port or URL');
        console.log('3. Network connectivity issues');
        console.log('4. Firewall blocking the connection');
        console.log('\nSUGGESTIONS:');
        console.log('- Verify the server is running with: ps aux | grep node');
        console.log('- Check the server logs for errors');
        console.log('- Verify the URL is correct (currently using ' + BASE_URL + ')');
        console.log('- Try setting the APP_URL environment variable if needed');
        return;
      }
      
      // 2. Attempt login
      console.log('\n2. Attempting login...');
      const loginResponse = await fetch(`${BASE_URL}${apiPrefix}/login`, {
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
      const contentType = loginResponse.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        responseBody = await loginResponse.json();
        console.log('Login response body:', responseBody);
      } else {
        console.log('Login response is not JSON:', await loginResponse.text());
      }
      
      if (loginStatus !== 200) {
        console.error('LOGIN FAILED');
        if (loginStatus === 500) {
          console.log('\nINTERNAL SERVER ERROR DETECTED. Possible causes:');
          console.log('- Database connection issues');
          console.log('- Password hash format issues');
          console.log('- Server-side exception during authentication');
        } else if (loginStatus === 401) {
          console.log('\nAUTHENTICATION FAILED. Possible causes:');
          console.log('- Incorrect username or password');
          console.log('- User account does not exist');
          console.log('- User account is locked or disabled');
        } else if (loginStatus === 404) {
          console.log('\nAPI ENDPOINT NOT FOUND. Possible causes:');
          console.log('- Login endpoint is not properly configured');
          console.log('- Server routing issue');
        }
      } else {
        console.log('LOGIN SUCCESSFUL');
      }
    } catch (e) {
      console.error('Error during debug:', e);
    }
  }

  await debugLogin();
})();
