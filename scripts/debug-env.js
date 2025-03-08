
// Debug script for environment variables
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables
dotenv.config();

console.log('Environment Debugging Tool');
console.log('=========================');

// Check .env file
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  console.log('✅ .env file exists at:', envPath);
  try {
    const envContent = readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n').filter(line => line.trim() !== '');
    console.log(`Found ${envLines.length} environment variables in .env file`);
    
    // Check for duplicate keys
    const keys = {};
    const duplicates = [];
    
    envLines.forEach(line => {
      if (line.trim().startsWith('#')) return; // Skip comments
      
      const match = line.match(/^([^=]+)=/);
      if (match) {
        const key = match[1].trim();
        if (keys[key]) {
          duplicates.push(key);
        } else {
          keys[key] = true;
        }
      }
    });
    
    if (duplicates.length > 0) {
      console.log('⚠️ Duplicate keys found in .env file:', duplicates.join(', '));
    } else {
      console.log('✅ No duplicate keys found in .env file');
    }
  } catch (err) {
    console.error('❌ Error reading .env file:', err.message);
  }
} else {
  console.log('❌ .env file not found at:', envPath);
}

// Check DATABASE_URL
if (process.env.DATABASE_URL) {
  console.log('✅ DATABASE_URL is set in environment');
  
  // Safely print the URL (hiding password)
  const safeUrl = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
  console.log('DATABASE_URL value:', safeUrl);
  
  // Check if it's using the right protocol for PostgreSQL
  if (process.env.DATABASE_URL.startsWith('postgresql://')) {
    console.log('✅ DATABASE_URL has correct PostgreSQL protocol');
  } else if (process.env.DATABASE_URL.startsWith('postgres://')) {
    console.log('✅ DATABASE_URL has correct PostgreSQL protocol (postgres://)');
  } else {
    console.log('❌ DATABASE_URL does not use PostgreSQL protocol - should start with postgresql:// or postgres://');
  }
} else {
  console.log('❌ DATABASE_URL is not set in environment');
}

// Check other important environment variables
['SESSION_SECRET', 'PORT', 'NODE_ENV'].forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName} is set to: ${process.env[varName]}`);
  } else {
    console.log(`❓ ${varName} is not set`);
  }
});

console.log('\nDebugging complete!');
