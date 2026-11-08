import { useCallback, useState } from "react";
import { formatDate } from "@/utils/format";

/** Direction of a column sort. */
export type SortDirection = "asc" | "desc";

/** Value a column can be sorted / filtered on. */
export type ColumnValue = string | number | boolean | Date | null | undefined;

/** Turns a row into the value shown in one column (used for sort + filter). */
export type ColumnAccessor<Row> = (row: Row) => ColumnValue;

/**
 * Map of `columnKey -> accessor`. The keys are the same keys used by
 * `<ColumnHeader columnKey="..." />` in the table header.
 */
export type ColumnAccessors<Row> = Record<string, ColumnAccessor<Row>>;

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface TableControls<Row> {
  /** Rows after the global filter, the per-column filters and the sort. */
  rows: Row[];
  /** Number of rows before any column filter / sort was applied. */
  totalCount: number;
  /** Number of rows after filtering (but ignoring sorting). */
  filteredCount: number;
  /** Currently sorted column (null when the table is unsorted). */
  sort: SortState | null;
  /** Per-column filter text, keyed by column key. */
  columnFilters: Record<string, string>;
  /** How many column filters currently hold a value. */
  activeFilterCount: number;
  /** True when at least one column filter or a sort is active. */
  isActive: boolean;
  /** Direction of a column, or null when the table is not sorted by it. */
  getSortDirection: (key: string) => SortDirection | null;
  /** Cycles a column: ascending -> descending -> unsorted. */
  toggleSort: (key: string) => void;
  /** Sets (or clears, passing null) the sorted column explicitly. */
  setSort: (key: string, direction?: SortDirection | null) => void;
  setColumnFilter: (key: string, value: string) => void;
  clearColumnFilter: (key: string) => void;
  /** Clears every column filter and the sort (the global search is untouched). */
  reset: () => void;
}

export interface UseTableControlsOptions<Row> {
  /**
   * Global filter applied before the per-column filters - typically the page
   * level search box, so the existing search keeps working unchanged.
   */
  filter?: (row: Row) => boolean;
  /** Optional sort applied on first render. */
  initialSort?: SortState | null;
}

/**
 * Lower-cases a value and strips diacritics so "Hà Nội" also matches "ha noi".
 * Mirrors the search normalisation used by the master data screens.
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function toSearchText(value: ColumnValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  // Booleans are searchable both as words and as raw flag text.
  if (typeof value === "boolean") return value ? "yes true" : "no false";
  return String(value);
}

function isBlank(value: ColumnValue): boolean {
  return value === null || value === undefined || value === "";
}

function compareValues(a: ColumnValue, b: ColumnValue): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  // `numeric: true` keeps "SKU-2" before "SKU-10" for text columns.
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Adds spreadsheet style header behaviour to any list screen: click a column
 * header to sort it (asc -> desc -> none) and type in the small input below a
 * header to filter that single column.
 *
 * ```tsx
 * const table = useTableControls(products, {
 *   name: (product) => product.name,
 *   price: (product) => Number(product.price),
 * }, { filter: (product) => matchesGlobalSearch(product) });
 *
 * table.rows; // filtered + sorted rows
 * ```
 */
export function useTableControls<Row>(
  rows: Row[] | null | undefined,
  accessors: ColumnAccessors<Row>,
  options: UseTableControlsOptions<Row> = {}
): TableControls<Row> {
  const [sort, setSortState] = useState<SortState | null>(options.initialSort ?? null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const toggleSort = useCallback((key: string) => {
    setSortState((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }, []);

  const setSort = useCallback((key: string, direction: SortDirection | null = "asc") => {
    setSortState(direction ? { key, direction } : null);
  }, []);

  const setColumnFilter = useCallback((key: string, value: string) => {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const clearColumnFilter = useCallback((key: string) => {
    setColumnFilters((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setColumnFilters({});
    setSortState(null);
  }, []);

  const getSortDirection = useCallback(
    (key: string) => (sort && sort.key === key ? sort.direction : null),
    [sort]
  );

  const list = rows ?? [];
  const activeFilters = Object.entries(columnFilters).filter(
    ([, value]) => value.trim() !== ""
  );

  const filtered = list.filter((row) => {
    if (options.filter && !options.filter(row)) return false;

    return activeFilters.every(([key, value]) => {
      const accessor = accessors[key];
      // Unknown column key (e.g. a header rendered without an accessor) never
      // hides rows.
      if (!accessor) return true;
      return normalizeText(toSearchText(accessor(row))).includes(normalizeText(value));
    });
  });

  const sortAccessor = sort ? accessors[sort.key] : undefined;
  const sorted =
    sort && sortAccessor
      ? [...filtered].sort((left, right) => {
          const leftValue = sortAccessor(left);
          const rightValue = sortAccessor(right);

          // Empty cells always sink to the bottom, whichever direction is used.
          const leftBlank = isBlank(leftValue);
          const rightBlank = isBlank(rightValue);
          if (leftBlank && rightBlank) return 0;
          if (leftBlank) return 1;
          if (rightBlank) return -1;

          const result = compareValues(leftValue, rightValue);
          return sort.direction === "asc" ? result : -result;
        })
      : filtered;

  return {
    rows: sorted,
    totalCount: list.length,
    filteredCount: filtered.length,
    sort,
    columnFilters,
    activeFilterCount: activeFilters.length,
    isActive: activeFilters.length > 0 || sort !== null,
    getSortDirection,
    toggleSort,
    setSort,
    setColumnFilter,
    clearColumnFilter,
    reset,
  };
}

export default useTableControls;

