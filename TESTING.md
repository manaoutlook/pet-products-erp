# Testing Guide for Pet Products ERP

## Overview

This document describes how to run and write automated tests for the Pet Products ERP application.

## Test Infrastructure

The application uses the following testing tools:

- **Vitest** - Fast unit test framework for JavaScript/TypeScript
- **@testing-library/react** - React component testing utilities
- **@testing-library/jest-dom** - Custom DOM matchers
- **Happy-DOM** - Lightweight DOM implementation for testing
- **Playwright** - End-to-end testing framework (planned)

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests with UI
```bash
npm run test:ui
```
This opens an interactive UI where you can see all tests, filter them, and see detailed results.

### Run Tests Once (CI Mode)
```bash
npm run test:run
```

### Run Backend Tests Only
```bash
npm run test:backend
```

### Run Frontend Tests Only
```bash
npm run test:frontend
```

### Run Tests with Coverage
```bash
npm run test:coverage
```
This generates a coverage report showing which parts of the code are tested.

## Test Structure

```
tests/
├── setup.ts                    # Global test setup
├── helpers/
│   ├── test-db.ts             # Database utilities
│   └── auth-helpers.ts        # Authentication helpers
├── fixtures/
│   └── test-data.ts           # Test data fixtures
├── backend/
│   └── api/
│       ├── auth.test.ts       # Authentication tests
│       ├── products.test.ts   # Product API tests
│       ├── inventory.test.ts  # Inventory API tests
│       ├── transfers.test.ts  # Transfer API tests
│       └── pos.test.ts        # POS system tests
└── frontend/
    ├── components/
    │   └── Sidebar.test.tsx   # Component tests
    └── pages/
        └── ProductsPage.test.tsx  # Page tests
```

## Writing Tests

### Backend API Test Example

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@db';
import { products } from '@db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';

describe('Product API Tests', () => {
  let testData;

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    testData = await seedTestData();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it('should create a new product', async () => {
    const [product] = await db.insert(products).values({
      name: 'Test Product',
      sku: 'TEST-001',
      price: '100.00',
      categoryId: testData.categories.category.id,
      brandId: testData.brands.brand.id,
      minStock: 10,
    }).returning();

    expect(product).toBeDefined();
    expect(product.name).toBe('Test Product');
  });
});
```

### Frontend Component Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/Layout/Sidebar';

describe('Sidebar Component', () => {
  it('should render navigation items', () => {
    render(<Sidebar />);
    
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
  });
});
```

## Test Database

Tests use a separate test database to avoid affecting development data.

### Setup Test Database

1. Create a test database:
```sql
CREATE DATABASE pet_erp_test;
```

2. Set environment variable:
```bash
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/pet_erp_test"
```

### Database Utilities

**cleanDatabase()** - Removes all data from test database
```typescript
await cleanDatabase();
```

**resetSequences()** - Resets all ID sequences to 1
```typescript
await resetSequences();
```

**seedTestData()** - Seeds basic test data (users, roles, stores, products)
```typescript
const testData = await seedTestData();
// Returns: { users, roles, stores, products, categories, brands, suppliers }
```

## Test Coverage

### Coverage Thresholds

The project maintains the following coverage thresholds:
- **Lines**: 70%
- **Functions**: 70%
- **Branches**: 70%
- **Statements**: 70%

### Viewing Coverage Reports

After running `npm run test:coverage`, open:
```
coverage/index.html
```

This shows a detailed breakdown of coverage by file.

## Best Practices

### 1. Test Isolation
- Each test should be independent
- Use `beforeEach` to set up clean state
- Use `afterEach` to clean up

### 2. Descriptive Test Names
```typescript
// Good
it('should create product with valid SKU', async () => { ... });

// Bad
it('test1', async () => { ... });
```

### 3. Arrange-Act-Assert Pattern
```typescript
it('should update product price', async () => {
  // Arrange
  const product = await createTestProduct();
  
  // Act
  await updateProductPrice(product.id, '150.00');
  
  // Assert
  const updated = await getProduct(product.id);
  expect(updated.price).toBe('150.00');
});
```

### 4. Test Edge Cases
- Empty inputs
- Invalid data
- Boundary conditions
- Error scenarios

### 5. Mock External Dependencies
- Use Vitest's `vi.mock()` for external APIs
- Mock database calls when testing business logic
- Mock authentication for frontend tests

## Debugging Tests

### Run Single Test File
```bash
npm test tests/backend/api/products.test.ts
```

### Run Single Test
```bash
npm test -t "should create a new product"
```

### Debug with VS Code
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test"],
  "console": "integratedTerminal"
}
```

## Continuous Integration

Tests run automatically on:
- Every push to main branch
- Every pull request
- Scheduled daily runs

### GitHub Actions Workflow

See `.github/workflows/test.yml` for the CI configuration.

## Common Issues

### Issue: "Cannot find module '@db'"
**Solution**: Make sure `vitest.config.ts` has correct path aliases

### Issue: "Database connection failed"
**Solution**: Ensure `TEST_DATABASE_URL` environment variable is set

### Issue: "Tests are slow"
**Solution**: 
- Use `test.concurrent` for independent tests
- Reduce database operations
- Mock external services

### Issue: "Flaky tests"
**Solution**:
- Ensure proper cleanup in `afterEach`
- Avoid time-dependent assertions
- Use `waitFor` for async operations

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Playwright Documentation](https://playwright.dev/)

## Contributing

When adding new features:
1. Write tests first (TDD approach recommended)
2. Ensure all tests pass
3. Maintain coverage above thresholds
4. Add tests to appropriate directory
5. Update this documentation if needed

## Support

For questions or issues with testing:
1. Check this documentation
2. Review existing test files for examples
3. Ask in team chat or create an issue
