
// CommonJS version of the admin password update script
const { scrypt, randomBytes } = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(scrypt);

// Recreate the crypto object from auth.ts
const crypto = {
  hash: async (password) => {
    try {
      if (!password) {
        throw new Error('Password is required');
      }

      const salt = randomBytes(16).toString("hex");
      console.log(`Generating hash for password with salt: ${salt}`);

      const derivedKey = await scryptAsync(password, salt, 64);
      const hashedPassword = `${derivedKey.toString("hex")}.${salt}`;

      console.log(`Successfully generated password hash. Length: ${hashedPassword.length}`);
      return hashedPassword;
    } catch (error) {
      console.error('Error in password hashing:', error);
      throw new Error('Failed to secure password. Please try again.');
    }
  }
};

// Self-executing async function
(async () => {
  try {
    // Generate hash for 'admin123'
    const hashedPassword = await crypto.hash('admin123');
    
    // Display the SQL query to run in production
    console.log('Run this SQL query in your production database:');
    console.log(`\nUPDATE users SET password = '${hashedPassword}' WHERE username = 'admin';\n`);
    
    console.log('This will update the admin user\'s password to "admin123"');
  } catch (error) {
    console.error('Error generating password hash:', error);
  }
})();
