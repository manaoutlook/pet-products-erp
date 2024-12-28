import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, roles, insertUserSchema } from "@db/schema";
import { db } from "@db";
import { eq, sql } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

// Improved crypto functions with better logging
const crypto = {
  hash: async (password: string) => {
    try {
      const salt = randomBytes(16).toString("hex");
      console.log(`Generated salt: ${salt}`);
      const buf = (await scryptAsync(password, salt, 64)) as Buffer;
      const hashedPassword = `${buf.toString("hex")}.${salt}`;
      console.log(`Successfully hashed password with salt`);
      return hashedPassword;
    } catch (error) {
      console.error('Error hashing password:', error);
      throw error;
    }
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    try {
      console.log('Comparing passwords...');
      const [hashedPassword, salt] = storedPassword.split(".");
      console.log(`Using salt: ${salt}`);
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
      throw error;
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
          return done(null, false, { message: "Incorrect username." });
        }

        const isMatch = await crypto.compare(password, user.password);
        console.log(`Password match result: ${isMatch}`);

        if (!isMatch) {
          return done(null, false, { message: "Incorrect password." });
        }

        // Don't include password in the user object
        const { password: _, ...userWithoutPassword } = user;
        return done(null, userWithoutPassword);
      } catch (err) {
        console.error('Login error:', err);
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, { id: user.id, username: user.username, role: user.role });
  });

  passport.deserializeUser(async (serializedUser: Express.User, done) => {
    try {
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

      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res
          .status(400)
          .send("Invalid input: " + result.error.issues.map(i => i.message).join(", "));
      }

      const { username, password, roleId } = result.data;

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      const hashedPassword = await crypto.hash(password);

      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          roleId,
        })
        .returning({
          id: users.id,
          username: users.username,
          role: {
            name: roles.name
          }
        });

      req.login(newUser, (err) => {
        if (err) {
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: newUser,
        });
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) {
        console.error('Login authentication error:', err);
        return next(err);
      }
      if (!user) {
        console.log('Login failed:', info?.message);
        return res.status(400).send(info?.message ?? "Login failed");
      }
      req.logIn(user, (err) => {
        if (err) {
          console.error('Login session error:', err);
          return next(err);
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
        return res.status(500).send("Logout failed");
      }
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).send("Session destruction failed");
        }
        res.json({ message: "Logout successful" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (req.isAuthenticated()) {
      const { id, username, role } = req.user;
      return res.json({ id, username, role });
    }
    res.status(401).send("Not logged in");
  });
}