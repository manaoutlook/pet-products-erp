# Database Migration Guide

## Prerequisites

Before running the database migration scripts, ensure you have:

1. Node.js 20.x installed
2. Required npm packages:
   - drizzle-orm
   - postgres
   - dotenv
   - tsx (for running TypeScript files)
3. Proper environment variables set in `.env`:
   ```env
   DATABASE_URL=postgresql://user:password@host:port/database
   ```

## Migration Scripts

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
   npm install drizzle-orm postgres dotenv
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

2. If you see schema-related errors:
   - Ensure schema.ts is properly copied to the production server
   - Verify all required tables exist in the database

3. For data type errors:
   - The script automatically handles date/time conversions
   - Verify data formats in the dump file match the schema

## Safety Notes

- Always backup your production database before running imports
- Test the migration process in a staging environment first
- Keep your database credentials secure
