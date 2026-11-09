import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Wide list tables (many columns, per-column filters, an Actions column) must scroll
 * horizontally instead of squeezing their last column off screen. The treatment lives in
 * two places:
 *
 *   - `client/src/components/ui/table.tsx` adds the `table-scroll` wrapper to every table,
 *   - each page adds `min-w-[...]` (readable width) and, when the Actions column is last,
 *     `table-actions-sticky` (freezes it on the right edge).
 *
 * These tests walk the page sources so a new screen cannot quietly ship a table that
 * regresses to crushed columns with invisible action buttons.
 */

const ROOT = path.resolve(__dirname, '../../..');
const PAGES_DIR = path.join(ROOT, 'client/src/pages');
const INDEX_CSS = path.join(ROOT, 'client/src/index.css');
const TABLE_COMPONENT = path.join(ROOT, 'client/src/components/ui/table.tsx');

/** No Actions column at all - nothing to freeze, but the list still needs to scroll. */
const NO_ACTIONS_COLUMN = new Set(['OrdersPage.tsx', 'StockTakePage.tsx']);

/**
 * Actions is deliberately not the last column here (Barcode trails it), so freezing the
 * last cell would pin the wrong column - the visible scrollbar covers this screen.
 */
const ACTIONS_NOT_LAST = new Set(['InventoryPage.tsx']);

function pageFiles(): string[] {
    return readdirSync(PAGES_DIR).filter((file) => file.endsWith('.tsx'));
}

/** Opening `<Table ...>` tags only (`<TableControlsBar`, `<TableHeader`, ... are excluded). */
function tableTags(source: string): string[] {
    return source.match(/<Table\b[^>]*>/g) ?? [];
}

describe('data table horizontal scroll treatment', () => {
    afterEach(() => {
        cleanup();
    });

    it('wraps every table in the scroll container by default', () => {
        const { container } = render(
            React.createElement(
                Table,
                null,
                React.createElement(
                    TableHeader,
                    null,
                    React.createElement(TableRow, null, React.createElement(TableHead, null, 'Name'))
                ),
                React.createElement(
                    TableBody,
                    null,
                    React.createElement(TableRow, null, React.createElement(TableCell, null, 'value'))
                )
            )
        );

        const wrapper = container.querySelector('.table-scroll');
        expect(wrapper).not.toBeNull();
        expect(wrapper!.tagName).toBe('DIV');
        expect(wrapper!.querySelector('table')).not.toBeNull();

        // An explicit containerClassName must not drop the default treatment.
        cleanup();
        const custom = render(
            React.createElement(Table, { containerClassName: 'extra-wrapper' }, null)
        );
        expect(custom.container.querySelector('.table-scroll.extra-wrapper')).not.toBeNull();
    });

    it('keeps the scrollbar styled and the last column frozen in index.css', () => {
        const css = readFileSync(INDEX_CSS, 'utf8');

        expect(css).toContain('.table-scroll {');
        // `@apply overflow-x-auto` is what makes the wrapper a horizontal scroller.
        expect(css).toMatch(/\.table-scroll \{[^}]*overflow-x-auto/);
        expect(css).toContain('.table-scroll::-webkit-scrollbar');

        expect(css).toContain('.table-actions-sticky th:last-child');
        expect(css).toContain('.table-actions-sticky td:last-child');
        const stickyRule = css.slice(css.indexOf('.table-actions-sticky th:last-child'));
        expect(stickyRule).toMatch(/position:\s*sticky/);
        expect(stickyRule).toMatch(/right:\s*0/);
        expect(stickyRule).toMatch(/white-space:\s*nowrap/);
    });

    it('declares the shared scroll class in the table component', () => {
        const source = readFileSync(TABLE_COMPONENT, 'utf8');
        expect(source).toContain('table-scroll');
    });

    it('gives every page list table a readable minimum width', () => {
        const offenders: string[] = [];

        for (const file of pageFiles()) {
            const source = readFileSync(path.join(PAGES_DIR, file), 'utf8');
            const tags = tableTags(source);
            if (tags.length === 0) continue;

            // At least one table on the screen must be pinned to a readable width; dialogs
            // inside the same page may keep the default (full width) behaviour.
            if (!tags.some((tag) => /min-w-\[/.test(tag))) {
                offenders.push(file);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('freezes the Actions column on every screen where it is the last column', () => {
        const offenders: string[] = [];

        for (const file of pageFiles()) {
            if (NO_ACTIONS_COLUMN.has(file) || ACTIONS_NOT_LAST.has(file)) continue;

            const source = readFileSync(path.join(PAGES_DIR, file), 'utf8');
            const hasActionsHeader = /<TableHead[^>]*>\s*Actions\s*<\/TableHead>/.test(source);
            if (!hasActionsHeader) continue;

            if (!/table-actions-sticky/.test(source)) {
                offenders.push(file);
            }
        }

        expect(offenders).toEqual([]);
    });
});
