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