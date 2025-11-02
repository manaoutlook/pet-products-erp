# Pet Products ERP

A comprehensive Enterprise Resource Planning (ERP) system designed specifically for pet product stores, built with modern web technologies.

## Features

- 🏪 **Multi-Store Management**: Manage multiple pet stores from a single dashboard
- 👥 **Role-Based Access Control**: Granular permissions for different user types
- 📦 **Inventory Management**: Track products across all store locations
- 🛒 **Order Processing**: Handle purchase orders and sales
- 📊 **Analytics & Reporting**: Store performance metrics and insights
- 🔐 **Secure Authentication**: User management with hashed passwords

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/manaoutlook/pet-products-erp.git
   cd pet-products-erp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your database credentials:
   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/your_database_name
   ```

4. **Set up the database**
   ```bash
   npm run db:setup
   ```

   This will:
   - Create all database tables
   - Seed initial data (users, roles, stores, products)
   - Set up the admin user

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   ```
   http://localhost:5000
   ```

### Default Login Credentials

- **Admin User**: `admin` / `admin123`
- **Demo Users**: See console output from `npm run db:setup` for other user accounts

## Database Configuration

### What's Included in Git

The following database-related files are version controlled:

- `db/schema.ts` - Database schema definitions
- `drizzle.config.ts` - Database configuration
- `scripts/` - All seed and setup scripts
- `.env.example` - Environment variable template

### Setting Up Your Database

1. **Create a PostgreSQL database**
   ```sql
   CREATE DATABASE pet_erp;
   CREATE USER pet_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE pet_erp TO pet_user;
   ```

2. **Configure environment**
   ```bash
   # Copy the example file
   cp .env.example .env

   # Edit with your database details
   DATABASE_URL=postgresql://pet_user:your_password@localhost:5432/pet_erp
   ```

3. **Initialize database**
   ```bash
   npm run db:setup
   ```

### Database Scripts

- `npm run db:push` - Push schema changes to database
- `npm run db:setup` - Full database setup (schema + seed data)
- `npm run db:seed` - Run seed scripts only

## Project Structure

```
pet-products-erp/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   └── lib/           # Utilities and configurations
├── server/                 # Express backend
│   ├── auth.ts            # Authentication setup
│   ├── routes.ts          # API routes
│   └── index.ts           # Server entry point
├── db/                    # Database configuration
│   ├── schema.ts          # Database schema
│   └── index.ts           # Database connection
├── scripts/               # Database setup and seed scripts
└── docs/                  # Documentation
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run check` - Type checking

### Database Development

When making schema changes:

1. Update `db/schema.ts`
2. Run `npm run db:push` to apply changes
3. Update seed scripts if needed
4. Test thoroughly

## Security Notes

- Never commit `.env` files with real credentials
- Use strong passwords for database users
- The application uses bcrypt for password hashing
- All API routes require authentication by default

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and ensure everything works
5. Submit a pull request

## License

MIT License - see LICENSE file for details
