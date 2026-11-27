import { useEffect, useState } from "react";

/**
 * Returns `value` only after it has stayed unchanged for `delay` milliseconds.
 *
 * Used by the ledger filter bar: typing in the search box or an amount field should not fire one
 * API request per keystroke, but the last value typed must still reach the query.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebouncedValue;
