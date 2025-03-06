# Database Migration Guide

## Prerequisites

Before running the database migration scripts, ensure you have:

1. Node.js 20.x installed
2. Required npm packages installed in your project:
   - drizzle-orm
   - postgres
   - dotenv
   - tsx
3. Proper environment variables set in `.env`:
   ```env
   DATABASE_URL=postgresql://user:password@host:port/database
   ```

## Required Files

You need these files in your project:

1. `db/schema.ts` - Your Drizzle schema definitions
2. `scripts/db-dump.ts` - Data export script
3. `scripts/db-import.ts` - Data import script
4. `.env` - Environment configuration

No compiled JavaScript files (*.js) are needed as we work directly with TypeScript files.

## Migration Process

### Export Data (Development Environment)

1. Navigate to project root:
   ```bash
   cd pet-products-erp
   ```

2. Run the export script:
   ```bash
   npx tsx scripts/db-dump.ts
   ```
   This will create a `database_dump.json` file in your project root.

### Import Data (Production Environment)

1. Copy required files to production:
   ```bash
   scp db/schema.ts scripts/db-dump.ts scripts/db-import.ts database_dump.json .env user@your-server:/var/www/pet-products-erp/
   ```

2. Install dependencies:
   ```bash
   cd /var/www/pet-products-erp
   npm install drizzle-orm postgres dotenv tsx
   ```

3. Run the import script:
   ```bash
   npx tsx scripts/db-import.ts
   ```

## Troubleshooting

1. If you see connection errors:
   - Verify DATABASE_URL is correctly set in .env
   - Ensure PostgreSQL is running and accessible
   - Check database user permissions

2. For import errors:
   - Ensure all required files are present
   - Verify the schema.ts file path is correct
   - Check that all dependencies are installed

3. For TypeScript-related errors:
   - Make sure tsx is installed
   - Verify the import paths in your scripts
   - Check that the schema file is properly exported

## Safety Notes

- Always backup your production database before running imports
- Test the migration process in a staging environment first
- Keep your database credentials secure
- Monitor the import process for any error messages

## Data Handling

The scripts automatically handle:
- Date/time conversions
- Foreign key relationships
- Data type validation
- Conflict resolution (using onConflictDoNothing)

## Post-Migration Verification

After running the import:
1. Check the console output for success messages
2. Verify table counts match the source database
3. Test application functionality with the imported data
4. Review any foreign key relationships