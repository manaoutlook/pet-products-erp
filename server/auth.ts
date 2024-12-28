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

// Improved crypto functions with better logging and error handling
const crypto = {
  hash: async (password: string) => {
    try {
      const salt = randomBytes(16).toString("hex");
      console.log(`Generated salt for password hashing`);
      const buf = (await scryptAsync(password, salt, 64)) as Buffer;
      const hashedPassword = `${buf.toString("hex")}.${salt}`;
      console.log(`Successfully hashed password`);
      return hashedPassword;
    } catch (error) {
      console.error('Error hashing password:', error);
      throw new Error('Error securing password. Please try again.');
    }
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    try {
      console.log('Comparing passwords...');
      const [hashedPassword, salt] = storedPassword.split(".");
      const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
      const suppliedPasswordBuf = (await scryptAsync(
        suppliedPassword,
        salt,
        64
      )) as Buffer;
      const isMatch = timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
      console.log(`Password comparison result: ${isMatch}`);
      return isMatch;
    } catch (error) {
      console.error('Error comparing passwords:', error);
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
        name: string;
      };
    }
  }
}

// Helper function to generate user-friendly error messages
function getAuthErrorMessage(error: string): { message: string; suggestion: string } {
  switch (error.toLowerCase()) {
    case 'incorrect username':
      return {
        message: "Username not found",
        suggestion: "Double-check your username or click 'Register' to create a new account"
      };
    case 'incorrect password':
      return {
        message: "Incorrect password",
        suggestion: "Verify your password is correct. Remember passwords are case-sensitive"
      };
    case 'user locked':
      return {
        message: "Account temporarily locked",
        suggestion: "Too many failed attempts. Please try again in 15 minutes"
      };
    case 'not authenticated':
      return {
        message: "Not logged in",
        suggestion: "Please log in to access this resource"
      };
    default:
      return {
        message: "Authentication failed",
        suggestion: "Please try again. If the problem persists, contact support"
      };
  }
}

export async function setupAdmin() {
  try {
    // Create admin role if it doesn't exist
    const [adminRole] = await db
      .insert(roles)
      .values({
        name: 'admin',
        description: 'Administrator role with full access'
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
        const [user] = await db
          .select({
            id: users.id,
            username: users.username,
            password: users.password,
            role: {
              name: roles.name
            }
          })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          console.log('User not found');
          const error = getAuthErrorMessage('incorrect username');
          return done(null, false, error);
        }

        const isMatch = await crypto.compare(password, user.password);
        console.log(`Password match result: ${isMatch}`);

        if (!isMatch) {
          const error = getAuthErrorMessage('incorrect password');
          return done(null, false, error);
        }

        // Don't include password in the user object
        const { password: _, ...userWithoutPassword } = user;
        console.log('Login successful:', userWithoutPassword);
        return done(null, userWithoutPassword);
      } catch (err) {
        console.error('Login error:', err);
        const error = getAuthErrorMessage('system error');
        return done(null, false, error);
      }
    })
  );

  passport.serializeUser((user, done) => {
    console.log('Serializing user:', { id: user.id, username: user.username });
    done(null, { id: user.id, username: user.username, role: user.role });
  });

  passport.deserializeUser(async (serializedUser: Express.User, done) => {
    try {
      console.log('Deserializing user:', serializedUser);
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          role: {
            name: roles.name
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
          message: info.message,
          suggestion: info.suggestion
        });
      }
      req.logIn(user, (err) => {
        if (err) {
          console.error('Login session error:', err);
          const error = getAuthErrorMessage('system error');
          return res.status(500).json(error);
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
        return res.status(500).json(getAuthErrorMessage('system error'));
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json(getAuthErrorMessage('system error'));
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
    res.status(401).json(getAuthErrorMessage('not authenticated'));
  });

  // Setup admin user
  setupAdmin().catch(console.error);
}