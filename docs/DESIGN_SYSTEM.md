# Smart ERP — Design System

A single, enterprise-grade colour and component system for the whole application.
Every screen draws from the same tokens, so buttons, forms, tables, navigation and
status colours are identical everywhere and in both light and dark mode.

- **Tokens live in** `client/src/index.css` — `:root` (light) and `.dark` (dark).
- **Tailwind mapping** lives in `tailwind.config.ts` (semantic colour names, shadows, radii, typography, spacing).
- **Theme switching** lives in `client/src/components/theme-provider.tsx` (`ThemeProvider` + `useTheme`), toggled from the sidebar footer.

---

## 1. Colour palette

| Role | Hex | Token | Tailwind utility |
| --- | --- | --- | --- |
| Primary (professional blue) | `#2563EB` | `--primary` | `bg-primary` / `text-primary` |
| Primary hover | `#1D4ED8` | `--primary-hover` | `hover:bg-primary-hover` |
| Primary active | `#1E40AF` | `--primary-active` | `active:bg-primary-active` |
| Secondary (slate gray) | `#475569` | `--secondary-solid` | `bg-secondary-solid` |
| Success (green) | `#16A34A` | `--success` | `text-success` / `bg-success` |
| Success fill (AA) | `#15803D` | `--success-strong` | `bg-success-strong` |
| Warning (amber) | `#F59E0B` | `--warning` | `bg-warning` |
| Danger / error (red) | `#DC2626` | `--destructive` | `bg-destructive` |
| Info (cyan) | `#0891B2` | `--info` | `text-info` / `bg-info` |
| Info fill (AA) | `#0E7490` | `--info-strong` | `bg-info-strong` |
| Page background | `#F8FAFC` | `--background` | `bg-background` |
| Surface / card | `#FFFFFF` | `--card`, `--surface` | `bg-card` |
| Main text | `#0F172A` | `--foreground` | `text-foreground` |
| Secondary text | `#64748B` | `--muted-foreground` | `text-muted-foreground` |
| Border | `#E2E8F0` | `--border`, `--input` | `border-border` |

### Status token families

Each status exposes the same shape, so a status colour is never improvised:

| Token | Use it for |
| --- | --- |
| `--success` / `--warning` / `--info` / `--destructive` | brand swatch: icons, borders, accents |
| `--*-strong` (+ `-hover`) | AA-safe fill behind white text, or text on a light surface |
| `--*-foreground` | text colour that pairs with the fill |
| `--*-subtle` / `--*-subtle-foreground` | tinted chips, alerts, badges, table highlights |

Utilities: `bg-success-subtle`, `text-success-subtle-foreground`, `border-warning/40`, `hover:bg-destructive-hover`, …

> Amber is the one status that requires **dark** text (`text-warning-foreground`) because
> white on amber cannot reach 4.5:1. This is baked into the button/badge variants.

---

## 2. Buttons

`<Button variant="…">` — one variant per intent:

| Variant | Colour | When to use |
| --- | --- | --- |
| `default` | Blue `#2563EB` | The primary action of a screen: Submit, Login, Apply, Search |
| `create` (alias `success`) | Green | Create / Add / Save |
| `view` | Blue tonal (tint + blue text) | View / Details / Preview |
| `update` (alias `warning`) | Amber | Edit / Update |
| `delete` (alias `destructive`) | Red | Delete / Remove / Cancel order |
| `info` | Cyan | Informational actions (export, sync, print) |
| `secondary` | Slate | Neutral secondary action |
| `outline` | Card + border | Tertiary action, Cancel |
| `ghost` | Transparent | Icon actions in dense toolbars |
| `link` | Blue text | Inline navigation |

Sizes: `default` (`h-control` = 40px), `sm` (36px), `lg` (44px), `icon`.
All variants share the same focus ring (`ring-ring`), radius, disabled opacity and icon sizing.

---

## 3. Forms

- Use `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` and `Label` primitives — they already read from `--input`, `--card`, `--ring`, `--muted-foreground`.
- Field chrome: card surface, 1px `border-input`, `shadow-xs`, blue border + soft ring on focus, muted background when disabled, red border + red ring when `aria-invalid`.
- Layout helpers: `.erp-form-group` (label + control + message), `.erp-form-row` (two column grid), `.erp-label`, `.erp-helper-text`, `.erp-error-text`, `.erp-required`, `.erp-input` (for raw inputs).

---

## 4. Data tables & grids

- Use `Table` primitives, or `.erp-table` for hand-written markup.
- Header: `--table-header-bg` (`#F1F5F9`), uppercase 12px semibold, `--table-header-foreground`.
- Rows: `border-border`, hover `--table-row-hover`, selected `--table-row-selected`, numeric cells `tabular-nums`.
- Statuses inside tables use the status chips (`Badge` variants `success` / `warning` / `info` / `destructive`).

---

## 5. Navigation

- Sidebar: `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border`.
- Items: `.erp-nav-item` (hover `--sidebar-accent`), nested `.erp-nav-subitem`.
- Active item: `.erp-nav-item-active` — **solid primary blue with white text** (the only place a nav row is filled).
- Top bar: `.erp-topbar` (card surface, bottom border, `shadow-xs`).
- Keyboard focus inside navigation uses `--sidebar-ring`.

---

## 6. Cards, widgets and dashboard

- `.erp-card` — white surface, `--radius-xl` (12px), `border-border`, `shadow-card`.
- `.erp-card-interactive` — adds hover elevation + blue-tinted border.
- `.erp-card-header` / `.erp-card-body`, `.erp-stat-card`, `.erp-stat-label`, `.erp-stat-value`.
- `.erp-toolbar` — filter/action bar above tables.
- `.erp-empty-state`, `.erp-divider`, `.erp-link`, `.erp-disabled`.

---

## 7. Typography

| Token | Size / line height | Use |
| --- | --- | --- |
| `--text-display` | 30 / 36 | Page title (`h1`, `.erp-page-title`) |
| `--text-heading` | 20 / 28 | Section heading (`h2`) |
| `--text-subheading` | 16 / 24 | Card title (`h3`) |
| `--text-body` | 14 / 24 | Body copy, table cells |
| `--text-label` | 14 / 20 | Form labels |
| `--text-caption` | 12 / 16 | Helper text, table headers, metadata |

Weights: `--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600, `--weight-bold` 700.
Family: `--font-sans` (Inter/system stack) with `--font-mono` for SKUs, barcodes and receipts.
Tailwind utilities: `text-display`, `text-heading`, `text-subheading`, `text-body`, `text-label`, `text-caption`, `font-sans`, `font-mono`.

Also provided: `.erp-page`, `.erp-page-header`, `.erp-page-title`, `.erp-page-subtitle`, `.erp-section-title`, `.erp-section-subtitle`.

---

## 8. Spacing, radius, elevation, motion

- Spacing scale: `--space-1` … `--space-12` (4px base) plus layout rhythm tokens
  `--page-gutter` (24px), `--section-gap` (24px), `--card-padding` (24px),
  `--field-gap` (16px), `--stack-gap` (8px), `--control-height` (40px), `--table-row-height` (48px).
  Tailwind: `p-gutter`, `gap-section`, `p-card`, `gap-field`, `h-control`.
- Radius: `--radius` (8px), `--radius-sm/md/lg/xl/2xl`, `--radius-pill`. Tailwind: `rounded-md`, `rounded-xl`, `rounded-pill`.
- Elevation: `shadow-xs`, `shadow-card`, `shadow-card-hover`, `shadow-dropdown`, `shadow-modal`, `shadow-focus`, `shadow-focus-danger`.
- Motion: `duration-fast` (120ms), `duration-base` (180ms), `duration-slow` (260ms), `ease-standard`.

---

## 9. Light and dark mode

- Both modes declare the **same token names**; only values change. No component needs a `dark:` override for colour.
- Dark canvas `#0F172A`, cards `#1E293B`, borders `#334155`, muted text `#94A3B8`.
- Brand hues (blue, green, amber, red, cyan) stay constant; subtle surfaces become deep tints and text moves to the 300–400 range for contrast.
- Toggle with `useTheme()` → `setTheme('light' | 'dark' | 'system')` / `toggleTheme()`. The choice persists in `localStorage` (`smart-erp-theme`) and defaults to the OS preference.
- The sidebar footer renders the light/dark switch next to the signed-in user.

---

## 10. Accessibility (WCAG 2.1 AA)

- Solid pairings: primary 5.2:1, success-strong 5.0:1, destructive 4.8:1, info-strong 5.4:1, secondary-solid 7.4:1, warning 9.3:1 (dark text).
- Muted text 4.9:1 on the page background, 5.3:1 on cards.
- Visible `:focus-visible` outline on every interactive element (`--ring`), plus a soft `shadow-focus` on fields.
- Colour is never the only signal: statuses always pair a colour with a label/icon.
- Disabled controls keep `aria-disabled`/`disabled` and drop to 50% opacity with `pointer-events: none`.

---

## 11. Rules of thumb

1. Never hard-code hex colours or Tailwind default palette classes (`bg-green-600`, `text-gray-900`) in features — use tokens.
2. One filled primary button per screen; everything else is tonal, outline or ghost.
3. Create = green, View = blue, Update = amber, Delete = red — no exceptions.
4. Cards are white on the page canvas; shadows are subtle (`shadow-card`), never `shadow-xl`.
5. New UI primitives must read from tokens so both themes and all screens stay consistent.

---

## 12. Tests

| File | Covers |
| --- | --- |
| `tests/frontend/theme/design-tokens.test.ts` | Token completeness (light + dark), palette values, Tailwind mapping, component classes |
| `tests/frontend/theme/button-variants.test.tsx` | Button variant → token class contract (CRUD colours) |
| `tests/frontend/theme/status-components.test.tsx` | Badge / Alert status variants, form fields, table tokens |
| `tests/frontend/theme/theme-provider.test.tsx` | Dark-mode toggle, persistence, system preference |

Run them with `npm run test:frontend` (or `npx vitest run tests/frontend/theme`).
