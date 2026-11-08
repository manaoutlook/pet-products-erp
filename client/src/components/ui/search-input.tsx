import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface SearchInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  /** Current text of the search field. */
  value: string;
  /** Called with the new text whenever the user types or clears the field. */
  onValueChange: (value: string) => void;
  /** Extra class names for the relative wrapper (e.g. width constraints). */
  containerClassName?: string;
}

/**
 * Search field with a leading magnifier icon and a trailing "clear" (x) button.
 *
 * The clear button is only rendered while the field has a value, so a new
 * search can be started with a single click instead of erasing the input by
 * hand. Clearing keeps the focus in the field so typing can continue right
 * away.
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onValueChange,
      containerClassName,
      className,
      placeholder = "Search...",
      disabled,
      onKeyDown,
      ...props
    },
    forwardedRef
  ) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current =
            node;
        }
      },
      [forwardedRef]
    );

    const clear = React.useCallback(() => {
      onValueChange("");
      inputRef.current?.focus();
    }, [onValueChange]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && value) {
        event.preventDefault();
        clear();
      }
    };

    return (
      <div className={cn("relative", containerClassName)}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={setRefs}
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("pl-8", value && "pr-8", className)}
          {...props}
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label="Clear search"
            title="Clear search"
            className={cn(
              "absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm",
              "text-muted-foreground transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  }
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
export default SearchInput;
