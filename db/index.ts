/**
 * Database Connection Configuration
 * 
 * This file establishes the database connection for data persistence only.
 * Following our architecture principles:
 * 1. Database is used ONLY for:
 *    - Data storage and retrieval
 *    - Relationship management
 *    - Performance optimization via indexing
 * 
 * 2. All business logic, validation, and access control are implemented
 *    at the application level, NOT in the database.
 * 
 * 3. No database-level policies, triggers, or stored procedures are used
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
