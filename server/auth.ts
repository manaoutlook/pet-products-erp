import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import bcrypt from "bcrypt";
import { users, roles, roleLocations, type SelectUser } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";

// Declare global Express.User type
declare global {
  namespace Express {
    interface User extends SelectUser {
      role: {
        id: number;
        name: string;
        permissions: {
          products: { create: boolean; read: boolean; update: boolean; delete: boolean };
          orders: { create: boolean; read: boolean; update: boolean; delete: boolean };
          inventory: { create: boolean; read: boolean; update: boolean; delete: boolean };
          users: { create: boolean; read: boolean; update: boolean; delete: boolean };
          stores: { create: boolean; read: boolean; update: boolean; delete: boolean };
        };
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

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      console.log(`Successfully generated password hash. Length: ${hashedPassword.length}`);
      return hashedPassword;
    } catch (error) {
      console.error('Error in password hashing:', error);
      throw new Error('Failed to secure password. Please try again.');
    }
  },

  compare: async (suppliedPassword: string, storedPassword: string) => {
    try {
      if (!suppliedPassword || !storedPassword) {
        throw new Error('Both supplied and stored passwords are required');
      }

      const isMatch = await bcrypt.compare(suppliedPassword, storedPassword);
      console.log(`Password comparison result: ${isMatch}`);

      return isMatch;
    } catch (error) {
      console.error('Error comparing passwords:', error);
      throw new Error('Error verifying password. Please try again.');
    }
  },
};

// Add API routes for user management
export function setupUserRoutes(app: Express) {
  // Create new user
  app.post("/api/users", async (req, res) => {
    try {
      const { username, password, roleId } = req.body;

      // Validate input
      if (!username || !password || !roleId) {
        return res.status(400).json({
          message: "Missing required fields",
          details: {
            username: !username ? "Username is required" : null,
            password: !password ? "Password is required" : null,
            roleId: !roleId ? "Role ID is required" : null
          }
        });
      }

      // Check if user exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.username, username),
      });

      if (existingUser) {
        return res.status(400).json({
          message: "Username already exists",
          suggestion: "Please choose a different username"
        });
      }

      // Hash password
      const hashedPassword = await crypto.hash(password);

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          roleId,
        })
        .returning();

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: newUser.id,
          username: newUser.username,
          roleId: newUser.roleId
        }
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        message: "Failed to create user",
        suggestion: "Please try again. If the problem persists, contact support."
      });
    }
  });

  // Get all users
  app.get("/api/users", async (_req, res) => {
    try {
      const allUsers = await db.query.users.findMany({
        with: {
          role: true
        }
      });

      // Remove password from response
      const sanitizedUsers = allUsers.map(({ password, ...user }) => user);

      res.json(sanitizedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        message: "Failed to fetch users",
        suggestion: "Please try again. If the problem persists, contact support."
      });
    }
  });
}

export async function setupAdmin() {
  try {
    console.log('Setting up admin user...');

    // Get or create System Administrator role location
    let adminRoleLocation = await db.query.roleLocations.findFirst({
      where: eq(roleLocations.description, 'System Administrator'),
    });

    if (!adminRoleLocation) {
      console.log('System Administrator role location not found, creating it...');
      const [newRoleLocation] = await db
        .insert(roleLocations)
        .values({
          description: 'System Administrator',
        })
        .returning();
      adminRoleLocation = newRoleLocation;
    }

    if (!adminRoleLocation) {
      throw new Error('Failed to create or find System Administrator role location');
    }

    console.log('Using role location:', adminRoleLocation);

    // Create admin role if it doesn't exist
    const [adminRole] = await db
      .insert(roles)
      .values({
        name: 'admin',
        description: 'Administrator role with full access',
        roleLocationId: adminRoleLocation.id,
        permissions: {
          products: { create: true, read: true, update: true, delete: true },
          orders: { create: true, read: true, update: true, delete: true },
          inventory: { create: true, read: true, update: true, delete: true },
          users: { create: true, read: true, update: true, delete: true },
          stores: { create: true, read: true, update: true, delete: true }
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
    } else {
      // Update existing admin password to use bcrypt
      const hashedPassword = await crypto.hash('admin123');
      await db
        .update(users)
        .set({
          password: hashedPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, existingAdmin.id));

      console.log('Admin user password updated successfully');
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
  setupUserRoutes(app); // Call the new function to set up user routes
}