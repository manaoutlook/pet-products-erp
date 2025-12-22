import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function migrate() {
    console.log('🔄 Starting migration: Remove roleTypes table and add isSystemAdmin column...');

    try {
        // Step 1: Add the new isSystemAdmin column to roles table
        console.log('Step 1: Adding is_system_admin column to roles table...');
        await sql`
      ALTER TABLE roles 
      ADD COLUMN IF NOT EXISTS is_system_admin BOOLEAN NOT NULL DEFAULT false
    `;
        console.log('✓ Column added');

        // Step 2: Update existing admin role to have isSystemAdmin = true
        console.log('Step 2: Updating admin role...');
        await sql`
      UPDATE roles 
      SET is_system_admin = true 
      WHERE name = 'admin'
    `;
        console.log('✓ Admin role updated');

        // Step 3: Drop the foreign key constraint and the roleTypeId column
        console.log('Step 3: Dropping role_type_id column...');
        await sql`
      ALTER TABLE roles 
      DROP COLUMN IF EXISTS role_type_id
    `;
        console.log('✓ Column dropped');

        // Step 4: Drop the roleTypes table
        console.log('Step 4: Dropping role_types table...');
        await sql`
      DROP TABLE IF EXISTS role_types CASCADE
    `;
        console.log('✓ Table dropped');

        console.log('\n✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
