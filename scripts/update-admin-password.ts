
import { crypto } from "../server/auth";

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
