
// Admin password reset script
import { db } from "../db";
import { users, roles } from "../db/schema";
import { eq } from "drizzle-orm";
import { crypto } from "../server/auth";

async function resetAdminPassword() {
  console.log('Starting admin password reset process...');
  
  try {
    // Get admin user
    const adminUser = await db.query.users.findFirst({
      where: eq(users.username, 'admin'),
      with: {
        role: true
      }
    });
    
    if (!adminUser) {
      console.log('Admin user not found, creating new admin user...');
      
      // Get admin role
      const adminRole = await db.query.roles.findFirst({
        where: eq(roles.name, 'admin')
      });
      
      if (!adminRole) {
        console.error('Admin role not found, cannot create admin user');
        return;
      }
      
      // Hash new admin password
      const hashedPassword = await crypto.hash('admin123');
      
      // Create admin user
      const [newUser] = await db
        .insert(users)
        .values({
          username: 'admin',
          password: hashedPassword,
          roleId: adminRole.id
        })
        .returning();
      
      console.log('Created new admin user with ID:', newUser.id);
    } else {
      console.log('Found existing admin user, resetting password...');
      
      // Hash new admin password
      const hashedPassword = await crypto.hash('admin123');
      
      // Update admin password
      await db
        .update(users)
        .set({
          password: hashedPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, adminUser.id));
      
      console.log('Admin password reset to "admin123"');
    }
    
    console.log('Admin password reset complete');
  } catch (error) {
    console.error('Error resetting admin password:', error);
  } finally {
    process.exit(0);
  }
}

resetAdminPassword().catch(console.error);
