
// Fix session and authentication issues
import { db } from '../db';
import { users, roles } from '../db/schema';
import { eq } from 'drizzle-orm';
import { crypto } from '../server/auth';

async function fixSessionAuth() {
  console.log('Fixing session and authentication issues...');
  
  try {
    // 1. Check if admin exists and reset password if needed
    const adminUser = await db.query.users.findFirst({
      where: eq(users.username, 'admin'),
      with: {
        role: true
      }
    });

    if (!adminUser) {
      console.error('Admin user not found in database!');
      return;
    }

    console.log('Found admin user:', {
      id: adminUser.id,
      username: adminUser.username,
      role: adminUser.role?.name
    });

    // 2. Re-hash the admin password to ensure it's in the correct format
    const newPasswordHash = await crypto.hash('admin123');
    console.log('Generated new password hash');

    // 3. Update the admin password
    const [updatedUser] = await db
      .update(users)
      .set({
        password: newPasswordHash,
        updatedAt: new Date()
      })
      .where(eq(users.id, adminUser.id))
      .returning();

    console.log('Updated admin user password');
    console.log('Password hash updated successfully for user ID:', updatedUser.id);
    console.log('New hash format contains dot separator:', updatedUser.password.includes('.'));
    
    console.log('\nSession authentication fix complete!');
    console.log('Please restart the server and try logging in again.');
  } catch (error) {
    console.error('Error fixing session auth:', error);
  } finally {
    process.exit(0);
  }
}

fixSessionAuth().catch(console.error);
