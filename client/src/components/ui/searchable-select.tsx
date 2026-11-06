import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface SearchableSelectOption {
  /** Stored value of the option (usually the record id as a string). */
  value: string;
  /** Primary, human readable text shown in the trigger and in the list. */
  label: string;
  /** Optional secondary text (also indexed by the search box). */
  description?: string | null;
}

interface SearchableSelectProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "value" | "onChange" | "type"
  > {
  /** Currently selected value, `null`/`undefined` when nothing is selected. */
  value: string | null | undefined;
  /** Called with the new value, or `null` when the selection is cleared. */
  onChange: (value: string | null) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /**
   * When provided, a "clear" entry is rendered at the top of the list that
   * resets the selection to `null` (used for optional fields).
   */
  clearLabel?: string;
}

/**
 * Dropdown with a built-in search box (Radix Popover + cmdk).
 *
 * The trigger is a `<button role="combobox">`, so it can be used inside a
 * `<FormControl>` and keeps the usual label/error wiring (`id`,
 * `aria-describedby`, `aria-invalid` are forwarded to that button).
 */
export const SearchableSelect = React.forwardRef<
  HTMLButtonElement,
  SearchableSelectProps
>(
  (
    {
      value,
      onChange,
      options,
      placeholder = "Select an option",
      searchPlaceholder = "Search...",
      emptyMessage = "No results found.",
      clearLabel,
      className,
      disabled,
      ...triggerProps
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const selected = options.find((option) => option.value === value) ?? null;

    const select = (nextValue: string | null) => {
      onChange(nextValue);
      setOpen(false);
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              className
            )}
            {...triggerProps}
          >
            <span className="truncate">
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {clearLabel ? (
                  <CommandItem value={clearLabel} onSelect={() => select(null)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value == null ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{clearLabel}</span>
                  </CommandItem>
                ) : null}
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    // Search matches both the label and the optional description.
                    value={`${option.label} ${option.description ?? ""} ${option.value}`}
                    onSelect={() => select(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        option.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                    {option.description ? (
                      <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
);
SearchableSelect.displayName = "SearchableSelect";

export default SearchableSelect;
