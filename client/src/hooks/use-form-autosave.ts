import { useEffect, useCallback } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { debounce } from 'lodash';

interface AutoSaveOptions {
  formId: string;
  enabled?: boolean;
  debounceMs?: number;
  onSave?: (data: any) => void;
}

export function useFormAutoSave<T extends Record<string, any>>(
  form: UseFormReturn<T>,
  { formId, enabled = true, debounceMs = 1000, onSave }: AutoSaveOptions
) {
  const saveToStorage = useCallback(
    (data: T) => {
      if (!enabled) return;
      try {
        localStorage.setItem(`form_autosave_${formId}`, JSON.stringify(data));
        onSave?.(data);
        console.log(`Auto-saved form ${formId}`);
      } catch (error) {
        console.error('Error auto-saving form:', error);
      }
    },
    [formId, enabled, onSave]
  );

  const debouncedSave = debounce(saveToStorage, debounceMs);

  useEffect(() => {
    if (!enabled) return;

    // Load saved data when form is initialized
    try {
      const saved = localStorage.getItem(`form_autosave_${formId}`);
      if (saved) {
        const data = JSON.parse(saved);
        form.reset(data);
        console.log(`Restored auto-saved form ${formId}`);
      }
    } catch (error) {
      console.error('Error restoring auto-saved form:', error);
    }

    // Subscribe to form changes
    const subscription = form.watch((data) => {
      debouncedSave(data as T);
    });

    return () => {
      subscription.unsubscribe();
      debouncedSave.cancel();
    };
  }, [form, formId, enabled, debouncedSave]);

  const clearAutoSave = useCallback(() => {
    try {
      localStorage.removeItem(`form_autosave_${formId}`);
      console.log(`Cleared auto-save for form ${formId}`);
    } catch (error) {
      console.error('Error clearing auto-saved form:', error);
    }
  }, [formId]);

  return { clearAutoSave };
}
