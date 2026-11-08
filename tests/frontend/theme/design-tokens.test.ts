import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static contract tests for the Smart ERP design token system.
 *
 * The tokens live in `client/src/index.css` (`:root` = light, `.dark` = dark)
 * and are mapped to Tailwind utilities in `tailwind.config.ts`. These tests
 * fail loudly when a token is renamed, dropped, or when a dark value is
 * forgotten, so the colour system cannot silently drift between modes.
 */

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

const css = read('client/src/index.css');
const tailwindConfig = read('tailwind.config.ts');

/** Reads a CSS block (`selector { ... }`) using brace matching. */
function extractBlock(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`);
    expect(start, `expected to find "${selector} {" in the stylesheet`).toBeGreaterThan(-1);

    let depth = 0;
    const openIndex = source.indexOf('{', start);
    for (let i = openIndex; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(openIndex + 1, i);
        }
    }
    throw new Error(`Unbalanced braces after "${selector}"`);
}

/** Returns every custom property declared in a block. */
function declarations(block: string): Record<string, string> {
    const result: Record<string, string> = {};
    const pattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block)) !== null) {
        result[match[1]] = match[2].trim();
    }
    return result;
}

const light = declarations(extractBlock(css, ':root'));
const dark = declarations(extractBlock(css, '.dark'));

const REQUIRED_COLOR_TOKENS = [
    '--background',
    '--foreground',
    '--surface',
    '--surface-foreground',
    '--card',
    '--card-foreground',
    '--popover',
    '--popover-foreground',
    '--muted',
    '--muted-foreground',
    '--accent',
    '--accent-foreground',
    '--primary',
    '--primary-foreground',
    '--primary-hover',
    '--primary-active',
    '--primary-subtle',
    '--primary-subtle-foreground',
    '--secondary',
    '--secondary-foreground',
    '--secondary-solid',
    '--secondary-solid-hover',
    '--secondary-solid-active',
    '--success',
    '--success-strong',
    '--success-foreground',
    '--success-subtle',
    '--success-subtle-foreground',
    '--warning',
    '--warning-strong',
    '--warning-foreground',
    '--warning-subtle',
    '--warning-subtle-foreground',
    '--destructive',
    '--destructive-foreground',
    '--destructive-hover',
    '--destructive-subtle',
    '--destructive-subtle-foreground',
    '--info',
    '--info-strong',
    '--info-foreground',
    '--info-subtle',
    '--info-subtle-foreground',
    '--border',
    '--input',
    '--ring',
    '--link',
    '--link-hover',
    '--table-header-bg',
    '--table-header-foreground',
    '--table-row-hover',
    '--table-row-selected',
    '--sidebar-background',
    '--sidebar-foreground',
    '--sidebar-accent',
    '--sidebar-accent-foreground',
    '--sidebar-active',
    '--sidebar-active-foreground',
    '--sidebar-border',
    '--sidebar-ring',
];

const REQUIRED_SYSTEM_TOKENS = [
    '--radius',
    '--radius-xl',
    '--font-sans',
    '--font-mono',
    '--text-display',
    '--text-heading',
    '--text-subheading',
    '--text-body',
    '--text-label',
    '--text-caption',
    '--weight-medium',
    '--weight-semibold',
    '--weight-bold',
    '--space-1',
    '--space-4',
    '--space-6',
    '--page-gutter',
    '--section-gap',
    '--card-padding',
    '--field-gap',
    '--control-height',
    '--shadow-card',
    '--shadow-card-hover',
    '--shadow-dropdown',
    '--shadow-modal',
    '--shadow-focus',
    '--duration-fast',
    '--ease-standard',
];

describe('Design tokens - light theme', () => {
    it('declares every colour token', () => {
        for (const token of REQUIRED_COLOR_TOKENS) {
            expect(light[token], `missing light token ${token}`).toBeDefined();
        }
    });

    it('declares the typography, spacing, radius and elevation scale', () => {
        for (const token of REQUIRED_SYSTEM_TOKENS) {
            expect(light[token], `missing light token ${token}`).toBeDefined();
        }
    });

    it('matches the approved Smart ERP palette', () => {
        expect(light['--primary']).toContain('221 83% 53%');
        expect(light['--primary-hover']).toContain('224 76% 48%');
        expect(light['--primary-active']).toContain('226 71% 40%');
        expect(light['--secondary-solid']).toContain('215 19% 35%');
        expect(light['--success']).toContain('142 71% 45%');
        expect(light['--warning']).toContain('38 92% 50%');
        expect(light['--destructive']).toContain('0 72% 51%');
        expect(light['--info']).toContain('189 94% 37%');
        expect(light['--background']).toContain('210 40% 98%');
        expect(light['--card']).toContain('0 0% 100%');
        expect(light['--foreground']).toContain('222 47% 11%');
        expect(light['--muted-foreground']).toContain('215 16% 47%');
        expect(light['--border']).toContain('214 32% 91%');
    });

    it('uses the primary blue for active navigation items', () => {
        expect(light['--sidebar-active']).toBe(light['--primary']);
        expect(light['--sidebar-active-foreground']).toBe(light['--primary-foreground']);
    });

    it('keeps the focus ring on-brand', () => {
        expect(light['--ring']).toBe(light['--primary']);
    });
});

describe('Design tokens - dark theme', () => {
    it('redefines every colour token used in light mode', () => {
        for (const token of REQUIRED_COLOR_TOKENS) {
            expect(dark[token], `missing dark token ${token}`).toBeDefined();
        }
    });

    it('uses a dark canvas with light text', () => {
        expect(dark['--background']).toContain('222 47% 11%');
        expect(dark['--foreground']).toContain('210 40% 98%');
        expect(dark['--card']).toBe(dark['--surface']);
    });

    it('keeps the same brand hues so components need no dark: overrides', () => {
        expect(dark['--primary']).toBe(light['--primary']);
        expect(dark['--destructive']).toBe(light['--destructive']);
        expect(dark['--sidebar-active']).toBe(light['--sidebar-active']);
    });

    it('raises the elevation shadows for the darker background', () => {
        expect(dark['--shadow-card']).toBeDefined();
        expect(dark['--shadow-card']).not.toBe(light['--shadow-card']);
    });
});

describe('Tailwind token mapping', () => {
    const colourMappings: Array<[string, string]> = [
        ['primary', 'hsl(var(--primary))'],
        ['secondary-solid', 'hsl(var(--secondary-solid))'],
        ['success', 'hsl(var(--success))'],
        ['success-subtle', 'hsl(var(--success-subtle))'],
        ['warning', 'hsl(var(--warning))'],
        ['info', 'hsl(var(--info))'],
        ['destructive', 'hsl(var(--destructive))'],
        ['surface', 'hsl(var(--surface))'],
        ['link', 'hsl(var(--link))'],
        ['table-header', 'hsl(var(--table-header-bg))'],
        ['sidebar-active', 'hsl(var(--sidebar-active))'],
    ];

    it('maps every semantic token group into the Tailwind colour palette', () => {
        for (const [name, value] of colourMappings) {
            expect(tailwindConfig, `tailwind config is missing colour "${name}"`).toContain(value);
        }
        for (const group of ['success:', 'warning:', 'info:', 'surface:', 'link:', 'table:']) {
            expect(tailwindConfig, `tailwind config is missing the "${group}" group`).toContain(group);
        }
    });

    it('maps elevation, radius, typography and spacing tokens', () => {
        for (const token of [
            'var(--shadow-card)',
            'var(--shadow-dropdown)',
            'var(--shadow-modal)',
            'var(--radius-xl)',
            'var(--font-sans)',
            'var(--text-display)',
            'var(--control-height)',
            'var(--page-gutter)',
        ]) {
            expect(tailwindConfig, `tailwind config is missing ${token}`).toContain(token);
        }
    });
});

describe('Global stylesheet component classes', () => {
    it('ships the documented ERP component classes', () => {
        for (const className of [
            '.erp-page-title',
            '.erp-section-title',
            '.erp-card',
            '.erp-stat-card',
            '.erp-label',
            '.erp-input',
            '.erp-table',
            '.erp-nav-item',
            '.erp-nav-item-active',
            '.erp-link',
            '.erp-empty-state',
        ]) {
            expect(css, `index.css is missing ${className}`).toContain(className);
        }
    });
});
