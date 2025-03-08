
// Check environment variables script
require('dotenv').config();

console.log('Checking critical environment variables...');

// Check DATABASE_URL
if (process.env.DATABASE_URL) {
  console.log('✅ DATABASE_URL is set');
  // Safely print the URL (hiding password)
  const safeUrl = process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@');
  console.log('  Value:', safeUrl);
} else {
  console.error('❌ DATABASE_URL is not set!');
}

// Check if running on Replit
if (process.env.REPL_ID || process.env.REPL_OWNER) {
  console.log('✅ Running on Replit');
  console.log('  REPL_ID:', process.env.REPL_ID);
  console.log('  REPL_OWNER:', process.env.REPL_OWNER);
} else {
  console.log('❌ Not running on Replit (or Replit environment variables not set)');
}
