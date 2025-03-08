
// Script to analyze server routes registration order

const fs = require('fs');
const path = require('path');

function analyzeRouteOrder() {
  try {
    console.log('=== Server Route Analysis ===');
    
    // Paths to check
    const serverIndexPath = path.join(process.cwd(), 'server', 'index.ts');
    const routesPath = path.join(process.cwd(), 'server', 'routes.ts');
    
    // Check if files exist
    if (!fs.existsSync(serverIndexPath)) {
      console.error(`Server index file not found at ${serverIndexPath}`);
      return;
    }
    
    if (!fs.existsSync(routesPath)) {
      console.error(`Routes file not found at ${routesPath}`);
      return;
    }
    
    // Read the files
    const serverIndexContent = fs.readFileSync(serverIndexPath, 'utf8');
    const routesContent = fs.readFileSync(routesPath, 'utf8');
    
    console.log('\nAnalyzing server/index.ts:');
    
    // Check for route registration order in index.ts
    if (serverIndexContent.includes('registerRoutes(app)')) {
      console.log('✅ Found route registration with registerRoutes(app)');
      
      // Check if Vite setup or catch-all route comes before API routes
      const viteSetupIndex = serverIndexContent.indexOf('setupVite(app');
      const registerRoutesIndex = serverIndexContent.indexOf('registerRoutes(app)');
      
      if (viteSetupIndex !== -1 && viteSetupIndex < registerRoutesIndex) {
        console.log('❌ Warning: setupVite(app) appears BEFORE registerRoutes(app)');
        console.log('   This may cause the Vite middleware to intercept API requests');
      } else if (viteSetupIndex !== -1) {
        console.log('✅ setupVite(app) appears after registerRoutes(app) - good');
      }
      
      // Check for catch-all routes
      if (serverIndexContent.includes('app.use("*"') || serverIndexContent.includes('app.use(\'*\'')) {
        console.log('⚠️ Found catch-all route in server/index.ts');
        console.log('   Make sure this comes AFTER API route registration');
      }
    } else {
      console.log('❌ Could not find route registration with registerRoutes(app)');
    }
    
    console.log('\nAnalyzing server/routes.ts:');
    
    // Check for health check endpoint
    if (routesContent.includes('app.get("/api/health"')) {
      console.log('✅ Found health check endpoint: app.get("/api/health")');
    } else {
      console.log('❌ Health check endpoint not found or may have a different path');
    }
    
    // Check for login endpoint
    if (routesContent.includes('app.post("/api/login"') || 
        routesContent.includes('app.post(\'/api/login\'')) {
      console.log('✅ Found login endpoint: app.post("/api/login")');
    } else {
      console.log('❌ Login endpoint not found or may have a different path');
    }
    
    console.log('\n=== Recommended Fixes ===');
    console.log('1. Make sure API routes are registered BEFORE any catch-all routes');
    console.log('2. Verify the server is listening on 0.0.0.0:5000 (not just localhost)');
    console.log('3. Check for middleware that might intercept API requests');
    console.log('4. Ensure routes are properly exported and registered');
    
  } catch (error) {
    console.error('Error analyzing routes:', error);
  }
}

analyzeRouteOrder();
