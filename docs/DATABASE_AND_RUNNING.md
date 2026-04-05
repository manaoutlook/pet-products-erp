# Database and How to Run

## Database Used

This application uses **PostgreSQL** as the database.

### Technology Stack
- **ORM**: Drizzle ORM with PostgreSQL driver (`postgres` package)
- **Schema Management**: Drizzle Kit for migrations
- **Configuration**: `drizzle.config.ts` with `dialect: "postgresql"`

### Database Configuration

The database connection is configured via the `DATABASE_URL` environment variable:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/database_name
```

Example for local development:
```env
DATABASE_URL=postgresql://postgres:admin123@localhost:5432/pet_erp
```

## How to Run This Application

### Prerequisites

1. **Node.js** (version 18 or higher)
2. **npm** (comes with Node.js)
3. **PostgreSQL database** installed and running

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Set Up Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file with your PostgreSQL database credentials:
```env
DATABASE_URL=postgresql://postgres:admin123@localhost:5432/pet_erp
NODE_ENV=development
PORT=5000
SESSION_SECRET=your-secret-key-here
```

### Step 3: Set Up the Database

```bash
npm run db:setup
```

This command will:
- Create all database tables based on the schema
- Seed initial data (users, roles, stores, products, customer profiles, inventory)
- Set up the default admin user

### Step 4: Start the Development Server

```bash
npm run dev
```

The server will start and watch for changes in the `server/index.ts` file.

### Step 5: Access the Application

Open your browser and navigate to:
```
http://localhost:5000
```

### Default Login Credentials

- **Username**: `admin`
- **Password**: `admin123`

## Additional Commands

### Database Management

| Command | Description |
|---------|-------------|
| `npm run db:push` | Push schema changes to the database |
| `npm run db:setup` | Full database setup (schema + seed data) |
| `npm run db:seed` | Run seed scripts only |
| `npm run db:seed-customers` | Seed customer profiles |
| `npm run db:seed-inventory` | Seed inventory data |

### Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run check` | Run TypeScript type checking |

### Testing Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run all tests once |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:ui` | Run tests with UI |

## Production Deployment

### Build for Production

```bash
npm run build
```

### Start Production Server

```bash
npm start
```

Or with NODE_ENV explicitly set:
```bash
NODE_ENV=production npm start
```

## Troubleshooting

### Database Connection Issues

1. Ensure PostgreSQL is running
2. Verify database credentials in `.env` file
3. Check that the database exists
4. Verify network connectivity to the database server

### Port Already in Use

If port 5000 is already in use, change the `PORT` value in your `.env` file:
```env
PORT=3000
```

### Schema Push Fails

1. Check database permissions
2. Verify the `DATABASE_URL` is correct
3. Ensure the database exists and is accessible

## Project Structure Overview

```
pet-products-erp/
├── client/          # React frontend (Vite + React)
├── server/          # Express.js backend
├── db/              # Database schema and connection
├── scripts/         # Database setup and seed scripts
├── migrations/      # Database migration files
└── docs/            # Documentation files
```

## Key Technologies

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend**: Express.js, TypeScript, Node.js
- **Database**: PostgreSQL, Drizzle ORM
- **Authentication**: Passport.js with session-based auth
- **Testing**: Vitest