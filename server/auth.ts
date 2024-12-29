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

// Improved crypto functions with better logging and error handling
const crypto = {
  hash: async (password: string) => {
    try {
      const salt = randomBytes(16).toString("hex");
      console.log(`Generated salt for password hashing: ${salt}`);
      const buf = (await scryptAsync(password, salt, 64)) as Buffer;
      const hashedPassword = `${buf.toString("hex")}.${salt}`;
      console.log(`Successfully hashed password. Hash length: ${hashedPassword.length}`);
      return hashedPassword;
    } catch (error) {
      console.error('Error hashing password:', error);
      throw new Error('Error securing password. Please try again.');
    }
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    try {
      console.log('Starting password comparison...');
      console.log('Stored password format:', storedPassword);

      const [hashedPassword, salt] = storedPassword.split(".");
      console.log('Extracted salt:', salt);
      console.log('Extracted hash length:', hashedPassword.length);

      const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
      const suppliedPasswordBuf = (await scryptAsync(
        suppliedPassword,
        salt,
        64
      )) as Buffer;

      console.log('Generated hash for supplied password length:', suppliedPasswordBuf.length);

      const isMatch = timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
      console.log(`Password comparison result: ${isMatch}`);
      console.log('Supplied password buffer:', suppliedPasswordBuf.toString('hex'));
      console.log('Stored password buffer:', hashedPasswordBuf.toString('hex'));

      return isMatch;
    } catch (error) {
      console.error('Error comparing passwords:', error);
      console.error('Stored password format:', storedPassword);
      throw new Error('Error verifying password. Please try again.');
    }
  },
};

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      role: {
        id: number;
        name: string;
        permissions: Record<string, Record<string, boolean>>;
      };
    }
  }
}

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
        console.log(`Attempting login for user: ${username}`);
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
          .where(eq(users.username, username))
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
        return done(null, userWithoutPassword);
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
      done(null, user);
    } catch (err) {
      console.error('Deserialization error:', err);
      done(err);
    }
  });

  app.post("/api/login", (req, res, next) => {
    console.log('Login request received:', { username: req.body.username });

    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) {
        console.error('Login authentication error:', err);
        return next(err);
      }
      if (!user) {
        console.log('Login failed:', info);
        return res.status(400).json({
          message: info.message || "Login failed",
          suggestion: "Please check your credentials and try again"
        });
      }
      req.logIn(user, (err) => {
        if (err) {
          console.error('Login session error:', err);
          return res.status(500).json({
            message: "Internal server error",
            suggestion: "Please try again later"
          });
        }
        console.log('Login successful for user:', user.username);
        return res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username, role: user.role },
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