
// Script to analyze server routes
const fs = require('fs');
const path = require('path');

console.log('=== Server Route Analysis ===');

// Check server/index.ts to see how the server is binding
const serverIndexPath = path.join(__dirname, '../server/index.ts');
const serverRoutePath = path.join(__dirname, '../server/routes.ts');
const serverAuthPath = path.join(__dirname, '../server/auth.ts');

try {
  const serverIndexCode = fs.readFileSync(serverIndexPath, 'utf8');
  const serverRouteCode = fs.readFileSync(serverRoutePath, 'utf8');
  const serverAuthCode = fs.readFileSync(serverAuthPath, 'utf8');
  
  console.log('\nAnalyzing server/index.ts:');
  
  // Check registerRoutes call
  if (serverIndexCode.includes('registerRoutes(app)')) {
    console.log('✅ Found route registration with registerRoutes(app)');
  } else {
    console.log('❌ Could not find route registration');
  }
  
  // Check vite setup
  if (serverIndexCode.includes('setupVite(app)') || serverIndexCode.includes('serveStatic(app)')) {
    const registerRoutesPos = serverIndexCode.indexOf('registerRoutes(app)');
    const setupVitePos = Math.max(
      serverIndexCode.indexOf('setupVite(app)'),
      serverIndexCode.indexOf('serveStatic(app)')
    );
    
    if (registerRoutesPos < setupVitePos) {
      console.log('✅ setupVite(app) appears after registerRoutes(app) - good');
    } else {
      console.log('❌ setupVite(app) appears before registerRoutes(app) - this could cause issues');
    }
  }
  
  // Check port binding
  if (serverIndexCode.includes('0.0.0.0')) {
    console.log('✅ Server appears to bind to 0.0.0.0 - good for external access');
  } else if (serverIndexCode.includes('localhost') || serverIndexCode.includes('127.0.0.1')) {
    console.log('❌ Server appears to bind only to localhost - this will prevent external access');
  }
  
  console.log('\nAnalyzing server/routes.ts:');
  
  // Check health endpoint
  if (serverRouteCode.includes('app.get("/api/health"')) {
    console.log('✅ Found health check endpoint: app.get("/api/health")');
    
    // Check if health endpoint requires auth
    if (serverRouteCode.indexOf('app.get("/api/health"') > serverRouteCode.indexOf('app.use(\'/api\', requireAuth)')) {
      console.log('❌ Health check endpoint is defined after auth middleware - it will require authentication');
    }
  } else {
    console.log('❌ Health check endpoint not found');
  }
  
  // Check login endpoint
  if (serverRouteCode.includes('app.post("/api/login"')) {
    console.log('✅ Found login endpoint: app.post("/api/login")');
    
    // Check if login endpoint requires auth
    if (serverRouteCode.indexOf('app.post("/api/login"') > serverRouteCode.indexOf('app.use(\'/api\', requireAuth)')) {
      console.log('❌ Login endpoint is defined after auth middleware - it will require authentication');
    }
  } else {
    console.log('❌ Login endpoint not found or may have a different path');
  }
  
  // Check route protection
  const requireAuthIndex = serverRouteCode.indexOf('app.use(\'/api\', requireAuth)');
  if (requireAuthIndex > -1) {
    console.log('⚠️ Found global API protection: app.use(\'/api\', requireAuth)');
    console.log('   Make sure login and health endpoints are defined BEFORE this line');
    
    // Calculate line number
    const lines = serverRouteCode.substring(0, requireAuthIndex).split('\n');
    console.log(`   This middleware appears around line ${lines.length} in routes.ts`);
  }
  
  console.log('\nAnalyzing server/auth.ts:');
  
  // Look for authentication setup
  if (serverAuthCode.includes('setupAuth(app)')) {
    console.log('✅ Found authentication setup function: setupAuth(app)');
    
    if (serverAuthCode.includes('app.post("/api/login"')) {
      console.log('✅ Found login endpoint in auth.ts: app.post("/api/login")');
    } else {
      console.log('❌ Login endpoint not found in auth.ts');
    }
  } else {
    console.log('❌ Authentication setup function not found');
  }
  
  console.log('\n=== Recommended Fixes ===');
  console.log('1. Make sure API routes are registered BEFORE any catch-all routes');
  console.log('2. Verify the server is listening on 0.0.0.0:5000 (not just localhost)');
  console.log('3. Check for middleware that might intercept API requests');
  console.log('4. Ensure routes are properly exported and registered');
  console.log('5. Make sure login and health endpoints are defined BEFORE app.use(\'/api\', requireAuth)');
  
} catch (err) {
  console.error('Error analyzing server files:', err.message);
}
