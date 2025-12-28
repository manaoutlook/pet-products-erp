import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, roles } from "@db/schema";
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
        isSystemAdmin: boolean;
        hierarchyLevel: string;
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
        throw new Error('Both supplied and stored passwords are required');
      }

      // Split stored password into hash and salt
      const [storedHash, salt] = storedPassword.split(".");
      if (!storedHash || !salt) {
        console.error('Invalid stored password format:', { storedPassword });
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

      const isMatch = timingSafeEqual(storedBuffer, suppliedBuffer);
      console.log(`Password comparison result: ${isMatch}`);

      return isMatch;
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

    // Create admin role if it doesn't exist
    const [adminRole] = await db
      .insert(roles)
      .values({
        name: 'admin',
        description: 'Administrator role with full access',
        isSystemAdmin: true,
        hierarchyLevel: 'admin',
        permissions: {
          products: { create: true, read: true, update: true, delete: true },
          orders: { create: true, read: true, update: true, delete: true },
          inventory: { create: true, read: true, update: true, delete: true },
          users: { create: true, read: true, update: true, delete: true },
          stores: { create: true, read: true, update: true, delete: true },
          masterData: { create: true, read: true, update: true, delete: true },
          pos: { create: true, read: true, update: true, delete: true },
          receipts: { create: true, read: true, update: true, delete: true }
        },
      })
      .onConflictDoNothing()
      .returning();

    // Get admin role ID and ensure it has the correct hierarchy level
    let [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, 'admin'))
      .limit(1);

    if (!role) {
      throw new Error('Failed to create or find admin role');
    }

    if (role.hierarchyLevel !== 'admin') {
      console.log('Updating existing admin role to correct hierarchy level...');
      const [updatedRole] = await db
        .update(roles)
        .set({ hierarchyLevel: 'admin' })
        .where(eq(roles.id, role.id))
        .returning();
      role = updatedRole;
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
        console.log(`Attempting login for user: ${username}`);

        // Convert username to lowercase for consistency
        const normalizedUsername = username.toLowerCase();

        // Include role information in the login query
        const [user] = await db
          .select({
            id: users.id,
            username: users.username,
            password: users.password,
            role: {
              id: roles.id,
              name: roles.name,
              isSystemAdmin: roles.isSystemAdmin,
              hierarchyLevel: roles.hierarchyLevel,
              permissions: roles.permissions
            }
          })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(eq(users.username, normalizedUsername))
          .limit(1);

        if (!user) {
          console.log('User not found in database');
          return done(null, false, { message: "Username not found" });
        }

        console.log('Found user, verifying password...');
        const isMatch = await crypto.compare(password, user.password);

        if (!isMatch) {
          console.log('Password verification failed');
          return done(null, false, { message: "Incorrect password" });
        }

        // Don't include password in the user object
        const { password: _, ...userWithoutPassword } = user;
        console.log('Login successful:', userWithoutPassword);
        return done(null, userWithoutPassword as Express.User);
      } catch (err) {
        console.error('Login error:', err);
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
            isSystemAdmin: roles.isSystemAdmin,
            hierarchyLevel: roles.hierarchyLevel,
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

  app.post("/api/login", (req, res, next) => {
    console.log('Login request received:', {
      username: req.body.username,
      hasPassword: !!req.body.password
    });

    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) {
        console.error('Login authentication error:', {
          error: err.message,
          stack: err.stack
        });
        return res.status(500).json({
          message: "Internal server error",
          suggestion: "Please try again later. If the problem persists, contact support."
        });
      }

      if (!user) {
        console.log('Login failed:', {
          reason: info.message,
          username: req.body.username
        });
        return res.status(400).json({
          message: info.message || "Invalid credentials",
          suggestion: info.message?.includes("password")
            ? "Please check your password and try again"
            : "Please check your username and try again"
        });
      }

      req.logIn(user, (err) => {
        if (err) {
          console.error('Login session error:', {
            error: err.message,
            stack: err.stack,
            userId: user.id
          });
          return res.status(500).json({
            message: "Failed to create session",
            suggestion: "Please try again. If the problem persists, clear your browser cookies."
          });
        }

        console.log('Login successful:', {
          userId: user.id,
          username: user.username,
          role: user.role.name
        });

        return res.json({
          message: "Login successful",
          user: {
            id: user.id,
            username: user.username,
            role: user.role
          }
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({
          message: "Error during logout",
          suggestion: "Please try again"
        });
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({
            message: "Error clearing session",
            suggestion: "Please try again"
          });
        }
        res.json({ message: "Logout successful" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    console.log('User info request:', {
      isAuthenticated: req.isAuthenticated(),
      user: req.user
    });

    if (req.isAuthenticated()) {
      const { id, username, role } = req.user;
      return res.json({ id, username, role });
    }
    res.status(401).json({
      message: "Not logged in",
      suggestion: "Please log in to access this resource"
    });
  });

  // Setup admin user
  setupAdmin().catch(console.error);
}
