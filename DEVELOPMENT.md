# Development Guidelines

## CRUD Operations UI/UX Standards

### Dialog Management
1. All dialogs (create/edit forms) should automatically close after successful operations
2. After a successful operation:
   - The dialog should close
   - The data should refresh
   - A success toast notification should appear
3. On error:
   - The dialog should remain open
   - An error toast notification should appear
   - Form validation errors should be displayed inline

### Implementation Example
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
