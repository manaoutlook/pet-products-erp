# Development Guidelines

## CRUD Operations Standards

### Dialog Management
1. All dialogs (create/edit forms) must automatically close after successful operations
2. After a successful operation:
   - The dialog should close
   - The data should refresh
   - A success toast notification should appear
3. On error:
   - The dialog should remain open
   - An error toast notification should appear
   - Form validation errors should be displayed inline

### Implementation Pattern
```typescript
const onSubmit = async (data: FormData) => {
  try {
    await mutation.mutateAsync(data);
    form.reset();
    // Close dialog
    const dialogCloseButton = document.querySelector('[data-state="open"] button[type="button"]');
    if (dialogCloseButton instanceof HTMLElement) {
      dialogCloseButton.click();
    }
  } catch (error) {
    // Error is handled by the mutation
  }
};
```

### Form Handling
1. Use react-hook-form with zod schema validation
2. Implement proper loading states during form submission
3. Disable submit button while processing
4. Show loading spinner during submission

### Data Management
1. Use react-query for data fetching and mutations
2. Invalidate queries after successful mutations
3. Implement proper error boundaries
4. Show loading states during data fetching

### User Feedback
1. Use toast notifications for operation results
2. Show inline validation errors
3. Provide clear success/error messages
4. Implement proper loading indicators

## Price Handling Standards

### Validation Rules
1. Prices must be non-negative
2. Maximum price limit: 999,999.99
3. Always display with 2 decimal places
4. Use proper currency formatting

### Implementation
1. Use the price utilities from `@/utils/price.ts`
2. Validate prices using `validatePrice` function
3. Format prices using `formatPrice` function
4. Normalize prices using `normalizePrice` function

## Code Organization

### File Structure
1. Keep related components in the same directory
2. Use feature-based organization for complex features
3. Shared utilities go in `utils` directory
4. Keep consistent file naming convention

### Component Guidelines
1. Use TypeScript interfaces for props
2. Implement proper error handling
3. Use loading states for async operations
4. Follow React best practices

### State Management
1. Use react-query for server state
2. Use local state for UI-only state
3. Implement proper cache invalidation
4. Handle loading and error states

## Testing Guidelines

### Unit Tests
1. Test all utility functions
2. Test component rendering
3. Test error handling
4. Test form validation

### Integration Tests
1. Test complete user flows
2. Test API integration
3. Test error scenarios
4. Test loading states

## API Guidelines

### Endpoints
1. Use RESTful conventions
2. Implement proper error handling
3. Use consistent response format
4. Include proper validation

### Security
1. Implement proper authentication
2. Use role-based access control
3. Validate all inputs
4. Sanitize all outputs
