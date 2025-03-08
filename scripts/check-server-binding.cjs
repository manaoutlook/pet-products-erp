
// Script to check server binding configuration

(async () => {
  try {
    console.log('=== Server Binding Check ===');
    console.log('Checking if the server is correctly binding to address 0.0.0.0');
    
    // Use dynamic import for node-fetch
    const fetch = (await import('node-fetch')).default;
    
    // Try to connect to the server using different addresses
    const addresses = [
      { url: 'http://0.0.0.0:5000/api/health', name: 'Direct IP binding' },
      { url: 'http://127.0.0.1:5000/api/health', name: 'Localhost' },
      { url: 'http://localhost:5000/api/health', name: 'Localhost name' }
    ];
    
    for (const { url, name } of addresses) {
      try {
        console.log(`\nTesting ${name} (${url})...`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'API-Server-Check-Script'
          },
          timeout: 5000
        });
        
        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log(`Content-Type: ${response.headers.get('content-type') || 'Not specified'}`);
        
        const text = await response.text();
        console.log(`Response: ${text.substring(0, 150)}...`);
      } catch (error) {
        console.error(`Error testing ${url}:`, error.message);
      }
    }
    
    console.log('\n=== Server Configuration Check ===');
    console.log('Check the following in your code:');
    console.log('1. Server is binding to 0.0.0.0 (not just localhost)');
    console.log('2. Server is listening on port 5000');
    console.log('3. API routes are properly registered BEFORE any catch-all routes');
    console.log('4. Check for any middleware that might intercept API requests');
    
    console.log('\n=== Checking Running Processes ===');
    console.log('Make sure the server process is running and binding to the correct port:');
    
  } catch (error) {
    console.error('Script error:', error);
  }
})();
