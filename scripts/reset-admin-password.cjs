
const { execSync } = require('child_process');
const path = require('path');

// Ensure the server is built before accessing database modules
console.log('Checking if server build is needed...');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('Server built successfully!');
} catch (err) {
  console.error('Failed to build server:', err.message);
  process.exit(1);
}

// Create a unique admin password
const newPassword = `admin${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

// Import necessary modules after build is complete
(async () => {
  try {
    console.log('Importing modules...');
    const { db } = await import('../db/index.js');
    const { users } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { crypto } = await import('../server/auth.js');
    
    console.log('Connecting to database...');
    // Test database connection
    await db.execute("SELECT 1 as db_check");
    
    console.log('Resetting admin password...');
    const hashedPassword = await crypto.hash(newPassword);
    
    // Update admin user password
    const updated = await db
      .update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.username, 'admin'))
      .returning({ id: users.id, username: users.username });
    
    if (updated.length === 0) {
      console.error('Admin user not found!');
      process.exit(1);
    }
    
    console.log(`\n✅ Admin password reset successfully!`);
    console.log(`\nNew credentials:`);
    console.log(`Username: admin`);
    console.log(`Password: ${newPassword}`);
    console.log(`\nPlease save these credentials in a secure location.`);
    
  } catch (error) {
    console.error('Error resetting admin password:', error);
    process.exit(1);
  }
})();
