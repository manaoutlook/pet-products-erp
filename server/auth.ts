import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, roles, roleTypes } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

interface Permission {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
}

interface Permissions {
  [key: string]: Permission;
}

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: {
        id: number;
        name: string;
        permissions: Permissions;
      };
    }
  }
}

// Improved crypto functions with better error handling and logging
export const crypto = {
  hash: async (password: string) => {
    try {
      if (!password) {
        throw new Error('Password is required');
      }

      const salt = randomBytes(16).toString("hex");
      console.log(`Generating hash for password with salt: ${salt}`);

      const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
      const hashedPassword = `${derivedKey.toString("hex")}.${salt}`;

      console.log(`Successfully generated password hash. Length: ${hashedPassword.length}`);
      return hashedPassword;
    } catch (error) {
      console.error('Error in password hashing:', error);
      throw new Error('Failed to secure password. Please try again.');
    }
  },

  compare: async (suppliedPassword: string, storedPassword: string) => {
    try {
      console.log('Starting password comparison...');

      // Validate inputs
      if (!suppliedPassword || !storedPassword) {
        console.error('Missing password input:', { 
          hasSuppliedPassword: !!suppliedPassword, 
          hasStoredPassword: !!storedPassword 
        });
        throw new Error('Both supplied and stored passwords are required');
      }

      // Split stored password into hash and salt
      const parts = storedPassword.split(".");
      if (parts.length !== 2) {
        console.error('Invalid stored password format:', { 
          storedPasswordLength: storedPassword.length,
          containsSeparator: storedPassword.includes('.'),
          parts: parts.length
        });
        throw new Error('Invalid stored password format');
      }
      
      const [storedHash, salt] = parts;
      if (!storedHash || !salt) {
        console.error('Invalid stored password components:', { 
          hasStoredHash: !!storedHash, 
          hasSalt: !!salt 
        });
        throw new Error('Invalid stored password format');
      }

      console.log('Generating hash with stored salt for comparison');
      const derivedKey = (await scryptAsync(suppliedPassword, salt, 64)) as Buffer;
      const suppliedHash = derivedKey.toString("hex");

      // Compare hashes using timing-safe comparison
      const storedBuffer = Buffer.from(storedHash, "hex");
      const suppliedBuffer = Buffer.from(suppliedHash, "hex");

      console.log('Comparing password hashes...', {
        storedHashLength: storedHash.length,
        suppliedHashLength: suppliedHash.length
      });

      try {
        const isMatch = timingSafeEqual(storedBuffer, suppliedBuffer);
        console.log(`Password comparison result: ${isMatch}`);
        return isMatch;
      } catch (timingError) {
        console.error('Timing-safe comparison error:', timingError);
        // Fallback to regular comparison if timing-safe fails
        console.log('Falling back to regular comparison');
        return storedHash === suppliedHash;
      }
    } catch (error: any) {
      console.error('Error comparing passwords:', error);
      if (error.message === 'Invalid stored password format') {
        throw error;
      }
      throw new Error('Error verifying password. Please try again.');
    }
  },
};

export async function setupAdmin() {
  try {
    console.log('Setting up admin user...');

    // Get or create System Administrator role type
    let adminRoleType = await db.query.roleTypes.findFirst({
      where: eq(roleTypes.description, 'System Administrator'),
    });

    if (!adminRoleType) {
      console.log('System Administrator role type not found, creating it...');
      const [newRoleType] = await db
        .insert(roleTypes)
        .values({
          description: 'System Administrator',
        })
        .returning();
      adminRoleType = newRoleType;
    }

    if (!adminRoleType) {
      throw new Error('Failed to create or find System Administrator role type');
    }

    console.log('Using role type:', adminRoleType);

    // Create admin role if it doesn't exist
    const [adminRole] = await db
      .insert(roles)
      .values({
        name: 'admin',
        description: 'Administrator role with full access',
        roleTypeId: adminRoleType.id,
        permissions: {
          products: { create: true, read: true, update: true, delete: true },
          orders: { create: true, read: true, update: true, delete: true },
          inventory: { create: true, read: true, update: true, delete: true },
          users: { create: true, read: true, update: true, delete: true }
        },
      })
      .onConflictDoNothing()
      .returning();

    // Get admin role ID
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, 'admin'))
      .limit(1);

    if (!role) {
      throw new Error('Failed to create or find admin role');
    }

    console.log('Admin role:', role);

    // Create admin user if it doesn't exist
    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.username, 'admin'))
      .limit(1);

    if (!existingAdmin) {
      const hashedPassword = await crypto.hash('admin123'); // Default password
      await db
        .insert(users)
        .values({
          username: 'admin',
          password: hashedPassword,
          roleId: role.id
        })
        .onConflictDoNothing();

      console.log('Admin user created successfully');
    }
  } catch (error) {
    console.error('Error setting up admin user:', error);
    throw error;
  }
}

export function setupAuth(app: Express) {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID || "pet-products-erp-secret",
    name: 'sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: app.get("env") === "production",
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const env = process.env.NODE_ENV || 'development';
        console.log(`[${env}] Attempting login for user: ${username}`);

        // Validate inputs
        if (!username || !password) {
          console.error(`[${env}] Missing credentials: username or password is empty`);
          return done(null, false, { message: "Username and password are required" });
        }

        // Convert username to lowercase for consistency
        const normalizedUsername = username.toLowerCase();
        console.log(`[${env}] Normalized username to: ${normalizedUsername}`);
        
        try {
          // First verify DB connection before query
          await db.execute("SELECT 1 as db_check");
          console.log(`[${env}] Database connection verified before login attempt`);
        } catch (dbError: any) {
          console.error(`[${env}] DATABASE CONNECTION ERROR:`, dbError.message);
          console.error(`Database URL configured: ${process.env.DATABASE_URL ? "Yes" : "No"}`);
          return done(new Error(`Database connection failed: ${dbError.message}`));
        }

        // Include role information in the login query
        try {
          console.log(`[${env}] Querying for user: ${normalizedUsername}`);
          
          // First check if the user exists at all
          const userCheck = await db
            .select({ id: users.id, username: users.username })
            .from(users)
            .where(eq(users.username, normalizedUsername))
            .limit(1);
            
          console.log(`[${env}] User check result:`, userCheck);
          
          if (userCheck.length === 0) {
            console.log(`[${env}] User not found in database: ${normalizedUsername}`);
            return done(null, false, { message: "Username not found" });
          }
          
          // Now get the complete user with role
          console.log(`[${env}] User exists, getting role information...`);
          
          const [user] = await db
            .select({
              id: users.id,
              username: users.username,
              password: users.password,
              role: {
                id: roles.id,
                name: roles.name,
                permissions: roles.permissions
              }
            })
            .from(users)
            .innerJoin(roles, eq(users.roleId, roles.id))
            .where(eq(users.username, normalizedUsername))
            .limit(1);

          if (!user) {
            console.log(`[${env}] User found but role information missing for: ${normalizedUsername}`);
            return done(null, false, { message: "User account configuration issue" });
          }

          console.log(`[${env}] Found user with role, verifying password...`);
          console.log(`[${env}] Password hash length: ${user.password.length}`);
          
          try {
            const isMatch = await crypto.compare(password, user.password);
            console.log(`[${env}] Password comparison result: ${isMatch}`);

            if (!isMatch) {
              console.log(`[${env}] Password verification failed for user: ${normalizedUsername}`);
              return done(null, false, { message: "Incorrect password" });
            }

            // Don't include password in the user object
            const { password: _, ...userWithoutPassword } = user;
            console.log(`[${env}] Login successful:`, userWithoutPassword);
            return done(null, userWithoutPassword as Express.User);
          } catch (passwordError: any) {
            console.error(`[${env}] PASSWORD VERIFICATION ERROR:`, passwordError.message);
            console.error(`[${env}] Password hash format:`, user.password.includes('.') ? 'Valid (contains separator)' : 'Invalid (missing separator)');
            return done(new Error(`Password verification failed: ${passwordError.message}`));
          }
        } catch (queryError: any) {
          console.error(`[${env}] USER QUERY ERROR:`, queryError.message);
          return done(new Error(`Database query failed: ${queryError.message}`));
        }
      } catch (err: any) {
        console.error(`[${process.env.NODE_ENV || 'development'}] LOGIN ERROR:`, err);
        console.error(`Stack trace: ${err.stack}`);
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    console.log('Serializing user:', { id: user.id, username: user.username, role: user.role });
    done(null, { id: user.id, username: user.username, role: user.role });
  });

  passport.deserializeUser(async (serializedUser: Express.User, done) => {
    try {
      console.log('Deserializing user:', serializedUser);
      // Include role information in deserialization query
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            id: roles.id,
            name: roles.name,
            permissions: roles.permissions
          }
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.id, serializedUser.id))
        .limit(1);

      if (!user) {
        return done(new Error("User not found"));
      }

      console.log('User deserialized:', user);
      done(null, user as Express.User);
    } catch (err) {
      console.error('Deserialization error:', err);
      done(err);
    }
  });

  // Authentication endpoints are now defined in routes.ts to ensure correct middleware order

  // Setup admin user
  setupAdmin().catch(console.error);
}