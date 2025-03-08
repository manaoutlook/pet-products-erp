
// Database environment variables check script
console.log('Checking database environment variables...');

// Check DATABASE_URL environment variable
console.log('\n=== DATABASE_URL Check ===');
if (process.env.DATABASE_URL) {
  console.log('✅ DATABASE_URL is set in environment');
  
  // Safely print the URL (hiding password)
  const safeUrl = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
  console.log('DATABASE_URL value:', safeUrl);
  
  // Check if it's using the right protocol for PostgreSQL
  if (process.env.DATABASE_URL.startsWith('postgresql://') || process.env.DATABASE_URL.startsWith('postgres://')) {
    console.log('✅ DATABASE_URL has correct PostgreSQL protocol');
  } else {
    console.log('❌ DATABASE_URL does not use PostgreSQL protocol - should start with postgresql:// or postgres://');
  }
} else {
  console.log('❌ DATABASE_URL is not set in environment');
}

// Print all environment variables (scrubbing secrets)
console.log('\n=== All Environment Variables ===');
Object.keys(process.env).sort().forEach(key => {
  let value = process.env[key];
  
  // Hide sensitive information
  if (key.includes('SECRET') || key.includes('KEY') || key.includes('PASSWORD') || key.includes('TOKEN') || key.includes('URL')) {
    value = '[REDACTED]';
  }
  
  console.log(`${key}: ${value}`);
});
