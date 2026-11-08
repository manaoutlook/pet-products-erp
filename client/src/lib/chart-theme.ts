/**
 * Chart colours, expressed with the design tokens from index.css.
 *
 * The dashboard chart used to hardcode recharts' default purple (`#8884d8`) and to
 * leave the grid, axes and tooltip on recharts' own black-on-white defaults, so the
 * chart was unreadable in dark mode. `hsl(var(--chart-1))` resolves through the same
 * CSS variables as the rest of the UI and therefore flips with the theme.
 */
export const chartTheme = {
  /** Primary series line - `--chart-1`. */
  line: "hsl(var(--chart-1))",
  /** Grid lines follow the border token so they stay subtle in both themes. */
  grid: "hsl(var(--border))",
  /** Axis lines and tick labels. */
  axis: "hsl(var(--muted-foreground))",
  tooltip: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    color: "hsl(var(--popover-foreground))",
    borderRadius: "0.5rem",
    fontSize: "0.75rem",
  },
} as const;
