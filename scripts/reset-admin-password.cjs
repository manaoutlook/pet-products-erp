
const { db } = require('../dist/db');
const { users } = require('../dist/db/schema');
const { eq } = require('drizzle-orm');
const { scrypt, randomBytes } = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  console.log(`Generating hash for password with salt: ${salt}`);
  
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${derivedKey.toString("hex")}.${salt}`;
}

async function resetAdminPassword() {
  try {
    console.log('Connecting to database...');
    
    // Test connection
    await db.execute('SELECT 1 as db_check');
    console.log('Database connection successful');
    
    // Find admin user
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, 'admin'))
      .limit(1);
      
    if (!adminUser) {
      console.error('Admin user not found!');
      return;
    }
    
    console.log('Admin user found, resetting password...');
    
    // Hash new password
    const newPassword = 'admin123'; // Default admin password
    const hashedPassword = await hashPassword(newPassword);
    
    // Update admin password
    await db
      .update(users)
      .set({
        password: hashedPassword,
        updatedAt: new Date()
      })
      .where(eq(users.id, adminUser.id));
      
    console.log('Admin password has been reset successfully');
    console.log('You can now login with:');
    console.log('Username: admin');
    console.log('Password: admin123');
    
  } catch (error) {
    console.error('Error resetting admin password:', error);
  } finally {
    process.exit(0);
  }
}

resetAdminPassword();
