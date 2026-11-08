import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';

const migrationsDir = path.resolve(__dirname, '../../migrations');

/**
 * `npm run db:push` is the only schema mechanism (see migrations/README.md).
 *
 * These assertions exist because the failure they guard against is silent: the Drizzle
 * journal listed 0000-0003 while twelve .sql files were present, so `migrate()` applied
 * four files and skipped the rest, leaving fresh databases without `stock_movements`,
 * product dimensions or `user_sessions` and failing much later with "column does not
 * exist".
 */
describe('migrations directory', () => {
    const sqlFiles = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

    it('keeps the hand-written history as reference files', () => {
        expect(sqlFiles.length).toBeGreaterThanOrEqual(12);
        expect(sqlFiles).toContain('0010_stock_movements.sql');
        expect(sqlFiles).toContain('0011_stock_movements_note.sql');
    });

    it('does not carry a partial Drizzle journal that migrate() would silently follow', () => {
        expect(existsSync(path.join(migrationsDir, 'meta', '_journal.json'))).toBe(false);
        expect(existsSync(path.join(migrationsDir, 'meta'))).toBe(false);
    });

    it('documents that db:push owns the schema', () => {
        const readme = readFileSync(path.join(migrationsDir, 'README.md'), 'utf8');

        expect(readme).toContain('npm run db:push');
        expect(readme).toMatch(/silently skipped/);
    });

    it('has no journal entry claiming an index that also belongs to another file', () => {
        // 0002 is duplicated by two unrelated files - one of the reasons the generated
        // history could not simply be back-filled.
        const duplicated = sqlFiles.filter((file) => file.startsWith('0002_'));
        expect(duplicated).toEqual(['0002_aberrant_ulik.sql', '0002_inter_store_transfers.sql']);
    });
});
