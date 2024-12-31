// Username validation schema
const userSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .regex(/^[a-z]+$/, "Username must contain only lowercase letters")
    .transform(val => val.toLowerCase()),
  // other fields...
});

// Login handling
const normalizedUsername = username.toLowerCase();