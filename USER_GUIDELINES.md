# User Management Guidelines

## Username Requirements and Handling

### Username Format
- Usernames must be in lowercase letters only
- Minimum length: 3 characters
- The system automatically converts usernames to lowercase during:
  - User creation
  - Username updates
  - Login attempts

### Implementation Details
1. Server-side Validation:
   - Zod schema enforces lowercase transformation
   - Username validation happens before database operations
   - Consistent validation across creation and updates

2. Authentication Flow:
   - Login process converts input to lowercase before comparison
   - Password verification remains case-sensitive
   - Error messages guide users on username requirements

### Best Practices
1. UI Implementation:
   - Form inputs should indicate lowercase requirement
   - Validation messages should be clear about case requirements
   - Real-time validation feedback recommended

2. Error Handling:
   - Clear error messages when username format is invalid
   - Proper feedback for duplicate usernames
   - Guide users to use lowercase in error messages

### Code Examples

```typescript
// Username validation schema
const userSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .transform(val => val.toLowerCase()),
  // other fields...
});

// Login handling
const normalizedUsername = username.toLowerCase();
```

## Rationale
- Ensures consistency in username storage and comparison
- Prevents duplicate usernames with different cases
- Simplifies username comparison operations
- Improves user experience by preventing case-sensitive login issues

## Impact Areas
- User creation forms
- Login screens
- User profile updates
- Database queries involving usernames
- API endpoints handling user data
