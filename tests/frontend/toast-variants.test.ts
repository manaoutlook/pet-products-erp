import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Toast notifications must be colour coded across the whole application:
 * successful operations use the green `success` variant and failed operations
 * use the red `destructive` variant (both render bold white text).
 *
 * Every `toast({ ... })` call therefore has to declare a variant. A call without
 * one silently falls back to the neutral (black on white) toast, which is what
 * this test guards against.
 */
const CLIENT_SRC = join(process.cwd(), 'client', 'src');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            return sourceFiles(fullPath);
        }
        if (!/\.(ts|tsx)$/.test(entry) || entry.startsWith('use-toast')) {
            return [];
        }
        return [fullPath];
    });
}

function toastCalls(source: string): Array<{ line: number; block: string }> {
    const calls: Array<{ line: number; block: string }> = [];
    const pattern = /\btoast\(\s*\{/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
        const start = source.indexOf('{', match.index + match[0].length - 1);
        let depth = 0;
        let end = start;

        for (; end < source.length; end += 1) {
            const char = source[end];
            if (char === '{') depth += 1;
            else if (char === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }

        calls.push({
            line: source.slice(0, start).split('\n').length,
            block: source.slice(start, end + 1),
        });
    }

    return calls;
}

const VARIANTS = ['"success"', "'success'", '"destructive"', "'destructive'"];

describe('Toast variants across the application', () => {
    it('declares a success or destructive variant on every toast() call', () => {
        const offenders: string[] = [];
        let totalCalls = 0;

        for (const file of sourceFiles(CLIENT_SRC)) {
            const source = readFileSync(file, 'utf8');

            for (const { line, block } of toastCalls(source)) {
                totalCalls += 1;
                const declaresVariant = /\bvariant:/.test(block);
                const isColourCoded = VARIANTS.some((variant) => block.includes(variant));

                if (!declaresVariant || !isColourCoded) {
                    offenders.push(
                        `${relative(process.cwd(), file)}:${line} -> ${block.replace(/\s+/g, ' ').slice(0, 140)}`
                    );
                }
            }
        }

        // Guard against the scanner silently matching nothing.
        expect(totalCalls).toBeGreaterThan(50);
        expect(offenders).toEqual([]);
    });
});
