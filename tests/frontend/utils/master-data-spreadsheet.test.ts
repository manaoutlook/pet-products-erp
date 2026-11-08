import { describe, it, expect, vi } from 'vitest';
import {
    MASTER_DATA,
    downloadMasterDataTemplate,
    exportMasterData,
    mapMasterDataHeaders,
    readMasterDataFile,
} from '@/utils/master-data-spreadsheet';

/**
 * Header mapping of the master data import (Categories / Brands / Suppliers).
 * The downloaded template must round-trip through the importer, otherwise the
 * "Download template then re-upload it" flow fails.
 */
describe('master-data-spreadsheet - header mapping', () => {
    it('maps the category template headers back onto the import fields', () => {
        const templateHeaders = MASTER_DATA.categories.fields.map((field) => field.label);
        const { fields, missingRequired, unmatched } = mapMasterDataHeaders(
            'categories',
            templateHeaders
        );

        expect(missingRequired).toEqual([]);
        expect(unmatched).toEqual([]);
        expect(fields.name).toBe(0);
        expect(fields.description).toBe(1);
        expect(fields.parent).toBe(2);
    });

    it('accepts friendly spellings for the category columns', () => {
        const { fields, missingRequired, unmatched } = mapMasterDataHeaders('categories', [
            'Sub Category',
            'Notes',
            'Sub Category Of',
            'Owner',
        ]);

        expect(missingRequired).toEqual([]);
        expect(fields.name).toBe(0);
        expect(fields.description).toBe(1);
        expect(fields.parent).toBe(2);
        // Unknown columns are reported instead of being silently dropped.
        expect(unmatched).toEqual(['Owner']);
    });

    it('requires a name column for every master data kind', () => {
        const expected = {
            categories: 'Category Name',
            brands: 'Brand Name',
            suppliers: 'Supplier Name',
        } as const;

        for (const kind of ['categories', 'brands', 'suppliers'] as const) {
            const { missingRequired } = mapMasterDataHeaders(kind, ['Description']);
            expect(missingRequired).toContain(expected[kind]);
        }
    });

    it('requires contact information and address for suppliers', () => {
        const { missingRequired } = mapMasterDataHeaders('suppliers', ['Supplier Name']);

        expect(missingRequired).toEqual(['Contact Information', 'Address']);
    });

    it('does not treat a description column as the supplier name', () => {
        const { fields, missingRequired } = mapMasterDataHeaders('suppliers', [
            'Vendor Name',
            'Contact Details',
            'Address',
        ]);

        expect(missingRequired).toEqual([]);
        expect(fields.name).toBe(0);
        expect(fields.contactInfo).toBe(1);
        expect(fields.address).toBe(2);
    });

    it('maps a brand file with only names', () => {
        const { fields, missingRequired, unmatched } = mapMasterDataHeaders('brands', [
            'Brand Name',
        ]);

        expect(missingRequired).toEqual([]);
        expect(unmatched).toEqual([]);
        expect(fields.name).toBe(0);
    });
});

describe('master-data-spreadsheet - template', () => {
    it('uses the plural screen name in the template file name', async () => {
        // Stub only the blob helpers - replacing the whole URL class breaks
        // xlsx / happy-dom internals.
        const createObjectURL = vi.fn(() => 'blob:mock');
        const revokeObjectURL = vi.fn();
        const originalCreate = URL.createObjectURL;
        const originalRevoke = URL.revokeObjectURL;
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

        try {
            const fileName = await downloadMasterDataTemplate('categories', 'csv');

            expect(fileName).toMatch(/^category-import-template-\d{4}-\d{2}-\d{2}\.csv$/);
            expect(createObjectURL).toHaveBeenCalledTimes(1);
            expect(revokeObjectURL).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
            Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
        }
    });
});

/**
 * The Export dropdown of the master data screens. The exported headers are the
 * import template labels, so the file can be imported back unchanged - these
 * tests also verify that round-trip and that text values (phone numbers) keep
 * their leading zeros.
 */
describe('master-data-spreadsheet - export', () => {
    const withDownloadSpy = async <T>(
        run: (downloads: Blob[]) => Promise<T>
    ): Promise<T> => {
        const downloads: Blob[] = [];
        const originalCreate = URL.createObjectURL;
        const originalRevoke = URL.revokeObjectURL;

        Object.defineProperty(URL, 'createObjectURL', {
            value: vi.fn((blob: Blob) => {
                downloads.push(blob);
                return 'blob:mock';
            }),
            configurable: true,
        });
        Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

        try {
            return await run(downloads);
        } finally {
            Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
            Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
        }
    };

    const csvOf = (blob: Blob): Promise<string> => blob.text();

    it('exports categories as CSV with the parent category name resolved', async () => {
        await withDownloadSpy(async (downloads) => {
            const fileName = await exportMasterData(
                'categories',
                [
                    { id: 1, name: 'Dogs', description: 'Dog products', parentId: null },
                    { id: 2, name: 'Dog Food', description: 'Dry food', parentId: 1 },
                ],
                'csv',
                { categoryNames: { 1: 'Dogs' } }
            );

            expect(fileName).toMatch(/^categories-\d{4}-\d{2}-\d{2}\.csv$/);
            expect(downloads).toHaveLength(1);

            const csv = await csvOf(downloads[0]);
            const [header, first, second] = csv.replace(/^\uFEFF/, '').split('\n');

            expect(header).toBe('Category Name,Description,Parent Category');
            expect(first).toBe('Dogs,Dog products,');
            // The child row names its parent even though the list only has parentId.
            expect(second).toBe('Dog Food,Dry food,Dogs');
        });
    });

    it('exports a brand list with the brand headers', async () => {
        await withDownloadSpy(async (downloads) => {
            await exportMasterData(
                'brands',
                [{ id: 1, name: 'Pedigree', description: 'Dog food brand' }],
                'csv'
            );

            const csv = await csvOf(downloads[0]);
            expect(csv.replace(/^\uFEFF/, '').trim().split('\n')).toEqual([
                'Brand Name,Description',
                'Pedigree,Dog food brand',
            ]);
        });
    });

    it('exports suppliers as Excel without losing leading zeros in phone numbers', async () => {
        await withDownloadSpy(async (downloads) => {
            const fileName = await exportMasterData(
                'suppliers',
                [{ id: 1, name: 'Acme Trading', contactInfo: '0901234567', address: '12 Nguyen Hue, HCMC' }],
                'xlsx'
            );

            expect(fileName).toMatch(/^suppliers-\d{4}-\d{2}-\d{2}\.xlsx$/);
            expect(downloads[0].type).toBe(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            expect(downloads[0].size).toBeGreaterThan(0);
        });
    });

    it('writes the exported categories so that they can be imported back', async () => {
        await withDownloadSpy(async (downloads) => {
            await exportMasterData(
                'categories',
                [
                    { id: 1, name: 'Dogs', description: 'Dog products', parentId: null },
                    { id: 2, name: 'Dog Food', description: 'Dry food', parentId: 1 },
                ],
                'csv',
                { categoryNames: { 1: 'Dogs' } }
            );

            const csv = await csvOf(downloads[0]);
            const parsed = await readMasterDataFile(
                'categories',
                new File([csv], 'categories.csv', { type: 'text/csv' })
            );

            expect(parsed.missingRequiredHeaders).toEqual([]);
            expect(parsed.unmatchedHeaders).toEqual([]);
            expect(parsed.rows).toEqual([
                { name: 'Dogs', description: 'Dog products', parent: '' },
                { name: 'Dog Food', description: 'Dry food', parent: 'Dogs' },
            ]);
        });
    });

    it('keeps a supplier phone number as text through a CSV round-trip', async () => {
        await withDownloadSpy(async (downloads) => {
            await exportMasterData(
                'suppliers',
                [{ id: 1, name: 'Acme Trading', contactInfo: '0901234567', address: 'HCMC' }],
                'csv'
            );

            const parsed = await readMasterDataFile(
                'suppliers',
                new File([await csvOf(downloads[0])], 'suppliers.csv', { type: 'text/csv' })
            );

            expect(parsed.rows[0]).toMatchObject({
                name: 'Acme Trading',
                contactInfo: '0901234567',
                address: 'HCMC',
            });
        });
    });
});

