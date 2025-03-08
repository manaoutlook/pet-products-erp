
// Script to check API endpoint accessibility
const fetch = require('node-fetch');

const BASE_URL = process.env.API_URL || 'http://0.0.0.0:5000';
const ROUTES_TO_CHECK = [
  '/',                 // Root path
  '/api',              // API root
  '/api/health',       // Health check
  '/api/login',        // Login
  '/api/user'          // User info
];

async function checkEndpoints() {
  console.log('=== API Endpoint Path Checker ===');
  console.log(`Testing API endpoints at ${BASE_URL}\n`);

  for (const route of ROUTES_TO_CHECK) {
    console.log(`Testing ${route === '/' ? 'Root' : route} (${route})...`);
    try {
      const response = await fetch(`${BASE_URL}${route}`);
      const contentType = response.headers.get('content-type');
      console.log(`Status: ${response.status} ${response.statusText}`);
      console.log(`Content-Type: ${contentType}`);
      
      let responseText = '';
      try {
        if (contentType && contentType.includes('application/json')) {
          const json = await response.json();
          responseText = JSON.stringify(json, null, 2);
        } else {
          responseText = await response.text();
        }
      } catch (e) {
        responseText = 'Error parsing response: ' + e.message;
      }
      
      console.log(`Response (first 150 chars): ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}\n`);
    } catch (error) {
      console.log(`Error: ${error.message}\n`);
    }
  }
  
  console.log('=== Nginx Configuration Check ===');
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
}
`);

  console.log('=== Possible Issues ===');
  console.log('1. API routes not configured correctly');
  console.log('2. Server not running or not listening on correct port/address');
  console.log('3. Nginx or other proxy not configured correctly');
  console.log('4. Firewall blocking connections');
}

checkEndpoints().catch(console.error);
