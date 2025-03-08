
const fs = require('fs');
const path = require('path');

console.log('=== Server Binding Check ===');

// Check server/index.ts to see how the server is binding
const serverIndexPath = path.join(__dirname, '../server/index.ts');
const serverRouteDefinition = path.join(__dirname, '../server/routes.ts');

try {
  const serverIndexCode = fs.readFileSync(serverIndexPath, 'utf8');
  const serverRoutesCode = fs.readFileSync(serverRouteDefinition, 'utf8');
  
  console.log('\nChecking how server is binding to network interfaces:');
  
  // Look for listen statements
  const listenMatches = serverIndexCode.match(/server\.listen\((.*?)\)/gs);
  if (listenMatches) {
    console.log('Found server.listen() calls:');
    listenMatches.forEach(match => {
      console.log(`  ${match.trim()}`);
    });
    
    // Check if binding to 0.0.0.0
    if (serverIndexCode.includes('0.0.0.0')) {
      console.log('✅ Server appears to be binding to 0.0.0.0 (all interfaces) - Good');
    } else if (serverIndexCode.includes('localhost') || serverIndexCode.includes('127.0.0.1')) {
      console.log('❌ Server may be binding only to localhost/127.0.0.1 - This can cause external access issues');
    }
  } else {
    console.log('❌ Could not find server.listen() call');
  }
  
  // Check middleware order
  console.log('\nChecking middleware registration order:');
  
  if (serverIndexCode.includes('app.use(express.json())')) {
    console.log('✅ express.json() middleware is registered');
  } else {
    console.log('❌ express.json() middleware not found - Required for parsing JSON request bodies');
  }

  // Check auth middleware
  if (serverRoutesCode.includes('setupAuth(app)')) {
    console.log('✅ Authentication middleware is set up');
  } else {
    console.log('❌ Authentication middleware (setupAuth) not found or not registered');
  }
  
  // Check for API routes using requireAuth
  if (serverRoutesCode.includes('app.use(\'/api\', requireAuth)')) {
    console.log('⚠️ Global requireAuth middleware found for /api paths - This will block /api/login access');
    console.log('   Login endpoint must be defined BEFORE this middleware to work correctly');
  }
  
  // Check for login route
  const loginRouteMatch = serverRoutesCode.match(/app\.post\(['"`]\/api\/login['"`]/);
  if (loginRouteMatch) {
    console.log('✅ Found login route definition');
    
    // Check if login route is defined before global auth middleware
    const loginRoutePos = serverRoutesCode.indexOf(loginRouteMatch[0]);
    const authMiddlewarePos = serverRoutesCode.indexOf('app.use(\'/api\', requireAuth)');
    
    if (loginRoutePos < authMiddlewarePos || authMiddlewarePos === -1) {
      console.log('✅ Login route is defined before global auth middleware - Good');
    } else {
      console.log('❌ Login route is defined AFTER global auth middleware - This will block login attempts');
      console.log('   The login route must be defined before app.use(\'/api\', requireAuth)');
    }
  } else {
    console.log('❌ Login route definition not found');
  }
  
} catch (err) {
  console.error(`Error reading server files: ${err.message}`);
}

// Check for port conflicts
console.log('\nChecking for other services that might be using port 5001:');
const { execSync } = require('child_process');
try {
  const portCheck = execSync('ss -tuln | grep :5001 || echo "No processes found on port 5001"').toString();
  console.log(portCheck);
} catch (err) {
  console.log('Could not check for port conflicts:', err.message);
}

console.log('\n=== Recommendations ===');
console.log('1. Ensure login endpoint is defined BEFORE applying requireAuth middleware to /api routes');
console.log('2. Verify the server is binding to 0.0.0.0:5001 and not just localhost');
console.log('3. Check if express.json() middleware is registered for parsing request bodies');
console.log('4. Verify the health check endpoint is accessible without authentication');
