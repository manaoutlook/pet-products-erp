
(async () => {
  try {
    // Use dynamic import for node-fetch
    const fetch = (await import('node-fetch')).default;

    const BASE_URL = process.env.APP_URL || 'http://0.0.0.0:5000';
    
    console.log('=== API Endpoint Path Checker ===');
    console.log(`Testing API endpoints at ${BASE_URL}`);
    
    // Define paths to test
    const paths = [
      { path: '/', name: 'Root' },
      { path: '/api', name: 'API Root' },
      { path: '/api/health', name: 'Health Check' },
      { path: '/api/login', name: 'Login' },
      { path: '/api/user', name: 'User' }
    ];
    
    // Test each path
    for (const { path, name } of paths) {
      try {
        console.log(`\nTesting ${name} (${path})...`);
        const response = await fetch(`${BASE_URL}${path}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'API-Endpoint-Check-Script'
          },
          timeout: 5000
        });
        
        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log(`Content-Type: ${response.headers.get('content-type') || 'Not specified'}`);
        
        // Try to get response as text
        const text = await response.text();
        
        // If it looks like JSON, try to parse it
        if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
          try {
            const json = JSON.parse(text);
            console.log('Response (JSON):', json);
          } catch (e) {
            console.log(`Response (first 150 chars): ${text.substring(0, 150)}...`);
          }
        } else {
          console.log(`Response (first 150 chars): ${text.substring(0, 150)}...`);
        }
      } catch (error) {
        console.error(`Error testing ${path}:`, error.message);
      }
    }
    
    console.log('\n=== Nginx Configuration Check ===');
    console.log('If you are using Nginx as a reverse proxy, make sure your configuration contains:');
    console.log(`
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;  # Make sure this matches your app's port
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`);

    console.log('\n=== Possible Issues ===');
    console.log('1. API routes not configured correctly');
    console.log('2. Server not running or not listening on correct port/address');
    console.log('3. Nginx or other proxy not configured correctly');
    console.log('4. Firewall blocking connections');
    
  } catch (error) {
    console.error('Script error:', error);
  }
})();
