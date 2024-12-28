import { readFileSync } from 'fs';
import { join } from 'path';

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

// Usage example:
// const result = checkCRUDImplementation('path/to/component.tsx');
// console.log(result.pass ? 'Passed!' : `Failed:\n${result.issues.join('\n')}`);
