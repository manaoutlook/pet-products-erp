import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { TableControls } from "@/hooks/use-table-controls";

export interface ColumnHeaderProps {
  /** Value returned by `useTableControls` for this table. */
  controls: TableControls<any>;
  /** Key of the column - must match a key in the accessors passed to the hook. */
  columnKey: string;
  /** Text shown in the header. */
  label: string;
  /** Show the sort toggle button (default true). */
  sortable?: boolean;
  /** Show the per-column filter input (default true). */
  filterable?: boolean;
  /** Placeholder of the per-column filter input. */
  filterPlaceholder?: string;
  /** Extra classes for the `<th>`. */
  className?: string;
}

/**
 * Table header cell with spreadsheet style behaviour:
 * click the label to sort (asc -> desc -> none) and use the small input to
 * search only the values of that column.
 */
export function ColumnHeader({
  controls,
  columnKey,
  label,
  sortable = true,
  filterable = true,
  filterPlaceholder,
  className,
}: ColumnHeaderProps) {
  const direction = controls.getSortDirection(columnKey);
  const filterValue = controls.columnFilters[columnKey] ?? "";
  const inputId = React.useId();

  const sortLabel =
    direction === "asc"
      ? `${label}: sorted ascending, activate to sort descending`
      : direction === "desc"
        ? `${label}: sorted descending, activate to remove sorting`
        : `${label}: not sorted, activate to sort ascending`;

  return (
    <TableHead
      scope="col"
      aria-sort={
        direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined
      }
      className={cn("h-auto py-2 align-top", className)}
    >
      <div className="flex min-w-[7rem] flex-col gap-1.5">
        {sortable ? (
          <button
            type="button"
            onClick={() => controls.toggleSort(columnKey)}
            aria-label={sortLabel}
            title={`Sort by ${label}`}
            className={cn(
              "-mx-1 flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-semibold uppercase tracking-wide",
              "transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              direction ? "text-foreground" : "text-table-header-foreground"
            )}
          >
            <span className="truncate">{label}</span>
            {direction === "asc" ? (
              <ArrowUp aria-hidden="true" className="h-3 w-3 shrink-0" />
            ) : direction === "desc" ? (
              <ArrowDown aria-hidden="true" className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronsUpDown aria-hidden="true" className="h-3 w-3 shrink-0 opacity-40" />
            )}
          </button>
        ) : (
          <span className="px-0.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-table-header-foreground">
            {label}
          </span>
        )}

        {filterable ? (
          <div className="relative">
            <label className="sr-only" htmlFor={inputId}>
              {`Filter by ${label}`}
            </label>
            <Input
              id={inputId}
              value={filterValue}
              onChange={(event) => controls.setColumnFilter(columnKey, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && filterValue) {
                  event.preventDefault();
                  controls.clearColumnFilter(columnKey);
                }
              }}
              placeholder={filterPlaceholder ?? `Filter ${label.toLowerCase()}`}
              className={cn(
                "h-7 py-0 pl-2 text-xs font-normal normal-case tracking-normal",
                // `min-w-0` lets the column fall back to the header's `min-w-[7rem]` floor
                // instead of being pinned to the input's intrinsic width. Without it a
                // table with many filterable columns eats all the available width and
                // pushes the last column (usually Actions) out of sight.
                "min-w-0",
                filterValue ? "pr-6" : "pr-2"
              )}
            />
            {filterValue ? (
              <button
                type="button"
                onClick={() => controls.clearColumnFilter(columnKey)}
                aria-label={`Clear ${label} filter`}
                title={`Clear ${label} filter`}
                className={cn(
                  "absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm",
                  "text-muted-foreground transition-colors hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                )}
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </TableHead>
  );
}

export interface TableControlsBarProps {
  /** Value returned by `useTableControls` for this table. */
  controls: TableControls<any>;
  /** What the rows are, e.g. "products" - used in the row counter. */
  noun?: string;
  className?: string;
}

/**
 * Small status strip shown above a table: how many rows are visible plus a
 * one-click "clear filters" action once a column filter or sort is active.
 */
export function TableControlsBar({ controls, noun = "rows", className }: TableControlsBarProps) {
  const { isActive, filteredCount, totalCount, activeFilterCount, sort } = controls;

  const clearLabel =
    activeFilterCount > 0 && sort
      ? "Clear filters and sort"
      : activeFilterCount > 0
        ? "Clear filters"
        : "Clear sort";

  return (
    <div
      className={cn(
        "mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground",
        className
      )}
    >
      <span aria-live="polite">
        {isActive ? `Showing ${filteredCount} of ${totalCount} ${noun}` : `${totalCount} ${noun}`}
      </span>
      {isActive ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={controls.reset}
          className="h-7 px-2 text-xs"
        >
          <X aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
          {clearLabel}
        </Button>
      ) : null}
    </div>
  );
}
