import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GUIDELINES_FILE = join(__dirname, '..', 'GUIDELINES.md');

interface CheckResult {
  pass: boolean;
  issues: string[];
}

function checkCRUDImplementation(filePath: string): CheckResult {
  const content = readFileSync(filePath, 'utf-8');
  const issues: string[] = [];

  // Check for dialog close implementation
  if (!content.includes('document.querySelector(\'[data-state="open"]\')')) {
    issues.push('Missing dialog close implementation after successful operation');
  }

  // Check for proper form handling
  if (!content.includes('react-hook-form') || !content.includes('zodResolver')) {
    issues.push('Not using react-hook-form with zod validation');
  }

  // Check for loading states
  if (!content.includes('isSubmitting') || !content.includes('disabled={')) {
    issues.push('Missing proper loading state handling');
  }

  // Check for toast notifications
  if (!content.includes('useToast') || !content.includes('toast({')) {
    issues.push('Missing toast notifications for user feedback');
  }

  return {
    pass: issues.length === 0,
    issues
  };
}

function checkPriceHandling(filePath: string): CheckResult {
  const content = readFileSync(filePath, 'utf-8');
  const issues: string[] = [];

  // Check for price utilities usage
  if (!content.includes('@/utils/price')) {
    issues.push('Not using price utilities');
  }

  // Check for price validation
  if (!content.includes('validatePrice(')) {
    issues.push('Missing price validation');
  }

  // Check for price formatting
  if (!content.includes('formatPrice(')) {
    issues.push('Missing price formatting');
  }

  return {
    pass: issues.length === 0,
    issues
  };
}

// Add main function to run checks
async function main() {
  if (process.argv.length < 3) {
    console.error('Please provide a file path to check');
    process.exit(1);
  }

  const filePath = process.argv[2];
  console.log(`Checking file: ${filePath}\n`);

  const crudResult = checkCRUDImplementation(filePath);
  console.log('CRUD Implementation Check:');
  if (crudResult.pass) {
    console.log('✅ All CRUD implementation checks passed');
  } else {
    console.log('❌ CRUD implementation issues found:');
    crudResult.issues.forEach(issue => console.log(`  - ${issue}`));
  }

  console.log('\nPrice Handling Check:');
  const priceResult = checkPriceHandling(filePath);
  if (priceResult.pass) {
    console.log('✅ All price handling checks passed');
  } else {
    console.log('❌ Price handling issues found:');
    priceResult.issues.forEach(issue => console.log(`  - ${issue}`));
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

// Export the functions for use in test scripts
export { checkCRUDImplementation, checkPriceHandling };