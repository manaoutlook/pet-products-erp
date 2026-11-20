import { describe, it, expect, vi, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
    EXPORT_COLUMNS,
    INVENTORY_IMPORT_FIELDS,
    downloadImportTemplate,
    exportInventory,
    mapHeaders,
    readSpreadsheetFile,
} from '@/utils/inventory-spreadsheet';

/**
 * Locks the Inventory import/export contract in place: the template headers, the
 * accepted aliases and the exported values all have to agree, otherwise a
 * re-exported file cannot be imported back unchanged.
 */

/** A real .csv File, so the parser is exercised through SheetJS rather than stubbed. */
function csvFile(rows: (string | number)[][], name = 'stock.csv'): File {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return new File([csv], name, { type: 'text/csv' });
}

const TEMPLATE_HEADERS = INVENTORY_IMPORT_FIELDS.map((field) => field.label);

describe('inventory-spreadsheet', () => {
    it('marks the SKU, type and quantity columns as required', () => {
        const required = INVENTORY_IMPORT_FIELDS.filter((field) => field.required).map(
            (field) => field.label
        );

        expect(required).toEqual(['Product SKU', 'Inventory Type', 'Quantity']);
    });

    it('maps the template headers back onto the import fields', () => {
        const templateHeaders = INVENTORY_IMPORT_FIELDS.map((field) => field.label);
        const { missingRequired, unmatched } = mapHeaders(templateHeaders);

        expect(missingRequired).toEqual([]);
        expect(unmatched).toEqual([]);
    });

    it('reports missing required columns', () => {
        const { missingRequired } = mapHeaders(['Product SKU']);

        expect(missingRequired).toEqual(['Inventory Type', 'Quantity']);
    });

    it('maps common header spellings to canonical fields', () => {
        const { fields, unmatched } = mapHeaders([
            'SKU',
            'Type',
            'Store',
            'Qty',
            'Rack',
        ]);

        expect(fields.productSku).toBe(0);
        expect(fields.inventoryType).toBe(1);
        expect(fields.store).toBe(2);
        expect(fields.quantity).toBe(3);
        // "Rack" is an accepted alias of Location.
        expect(fields.location).toBe(4);
        expect(unmatched).toEqual([]);
    });

    it('exports the inventory type as a readable label and the quantity as a number', () => {
        const typeColumn = EXPORT_COLUMNS.find((column) => column.header === 'Inventory Type');
        const quantityColumn = EXPORT_COLUMNS.find((column) => column.header === 'Quantity');

        expect(typeColumn).toBeDefined();
        expect(
            typeColumn!.value({
                quantity: 5,
                inventoryType: 'DC',
            })
        ).toBe('Distribution Center');
        expect(
            typeColumn!.value({
                quantity: 5,
                inventoryType: 'STORE',
            })
        ).toBe('Retail Store');

        expect(quantityColumn!.value({ quantity: 42 })).toBe(42);
    });

    it('exports the supplier from the product, not from the stock row', () => {
        const supplierColumn = EXPORT_COLUMNS.find((column) => column.header === 'Supplier');

        expect(supplierColumn).toBeDefined();
        expect(
            supplierColumn!.value({
                quantity: 5,
                product: { name: 'Food', sku: 'F-1', supplier: { name: 'Product Supplier' } },
            })
        ).toBe('Product Supplier');
        expect(
            supplierColumn!.value({
                quantity: 5,
                product: { name: 'Food', sku: 'F-1', supplier: null },
            })
        ).toBe('');
    });

    it('treats a Supplier column from an older template as ignored', () => {
        const { fields, unmatched } = mapHeaders(['Product SKU', 'Inventory Type', 'Quantity', 'Supplier']);

        expect(fields.productSku).toBe(0);
        expect(fields.inventoryType).toBe(1);
        expect(fields.quantity).toBe(2);
        expect(unmatched).toEqual(['Supplier']);
        // There is no canonical supplier field any more: the product owns it.
        expect('supplier' in fields).toBe(false);
    });

    it('leaves the dates blank when they are not set', () => {
        const purchaseColumn = EXPORT_COLUMNS.find((column) => column.header === 'Purchase Date');

        expect(purchaseColumn!.value({ quantity: 1, purchaseDate: null })).toBe('');
        expect(purchaseColumn!.value({ quantity: 1, purchaseDate: '2024-10-15' })).toBe('2024-10-15');
    });

    it('derives the stock status from the quantity and the product minimum', () => {
        const status = EXPORT_COLUMNS.find((column) => column.header === 'Status')!;

        expect(status.value({ quantity: 0 })).toBe('Out of Stock');
        expect(status.value({ quantity: -3 })).toBe('Out of Stock');
        expect(status.value({ quantity: 5, product: { name: 'P', sku: 'S', minStock: 10 } })).toBe('Low Stock');
        // Exactly at the minimum is already low.
        expect(status.value({ quantity: 10, product: { name: 'P', sku: 'S', minStock: 10 } })).toBe('Low Stock');
        expect(status.value({ quantity: 11, product: { name: 'P', sku: 'S', minStock: 10 } })).toBe('In Stock');
        // No minimum configured means only "out of stock" can trip.
        expect(status.value({ quantity: 1, product: { name: 'P', sku: 'S' } })).toBe('In Stock');
    });

    it('prints the day part of a Date and passes unknown inventory types through', () => {
        const purchase = EXPORT_COLUMNS.find((column) => column.header === 'Purchase Date')!;
        const type = EXPORT_COLUMNS.find((column) => column.header === 'Inventory Type')!;

        expect(purchase.value({ quantity: 1, purchaseDate: new Date('2024-10-15T10:30:00.000Z') })).toBe('2024-10-15');
        expect(purchase.value({ quantity: 1, purchaseDate: '2024-10-15T10:30:00.000Z' })).toBe('2024-10-15');
        expect(type.value({ quantity: 1, inventoryType: 'TRANSIT' })).toBe('TRANSIT');
        expect(type.value({ quantity: 1, inventoryType: null })).toBe('');
    });
});

describe('readSpreadsheetFile', () => {
    it('maps the template headers and keeps the original cell values', async () => {
        const file = csvFile([
            TEMPLATE_HEADERS,
            ['SKU-1', 'Dog Food', 'Distribution Center', 'Main Warehouse', 12, 'Rack A', '2024-10-15', '2026-10-15'],
            ['', '', '', '', '', '', '', ''],
            ['SKU-2', 'Cat Food', 'Retail Store', 'Shop 1', 3, '', '', ''],
        ]);

        const parsed = await readSpreadsheetFile(file);

        expect(parsed.fileName).toBe('stock.csv');
        expect(parsed.sheetName).toBeTruthy();
        expect(parsed.missingRequiredHeaders).toEqual([]);
        // The blank row is skipped, the two real rows are kept.
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0]).toMatchObject({ productSku: 'SKU-1', quantity: 12, location: 'Rack A' });
        expect(parsed.preview[1].productSku).toBe('SKU-2');
    });

    it('accepts the alias headers of an older template', async () => {
        const parsed = await readSpreadsheetFile(
            csvFile([
                ['SKU', 'Type', 'Qty', 'Warehouse'],
                ['SKU-9', 'STORE', 4, 'Shop 2'],
            ]),
        );

        expect(parsed.rows[0]).toMatchObject({ productSku: 'SKU-9', quantity: 4, store: 'Shop 2' });
    });

    it('names the missing required columns and how to fix it', async () => {
        await expect(readSpreadsheetFile(csvFile([['Product SKU'], ['SKU-1']]))).rejects.toThrow(
            /Missing required columns: Inventory Type, Quantity/,
        );
    });

    it('reports a single missing column in the singular', async () => {
        await expect(
            readSpreadsheetFile(csvFile([['Product SKU', 'Inventory Type'], ['SKU-1', 'DC']])),
        ).rejects.toThrow(/Missing required column: Quantity/);
    });

    it('rejects an empty sheet', async () => {
        await expect(readSpreadsheetFile(csvFile([]))).rejects.toThrow('The selected sheet is empty.');
    });

    it('rejects a file that is not a spreadsheet at all', async () => {
        const file = new File(['this is not a workbook'], 'notes.txt', { type: 'text/plain' });

        // SheetJS can sometimes salvage text; either way the operator gets a readable message
        // instead of a stack trace.
        await expect(readSpreadsheetFile(file)).rejects.toThrow(/could not be read|empty|Missing required/);
    });
});
describe('exportInventory / downloadImportTemplate', () => {
    const createObjectURL = vi.fn((blob: Blob) => 'blob:export');
    const revokeObjectURL = vi.fn();

    function stubObjectUrls() {
        createObjectURL.mockClear();
        revokeObjectURL.mockClear();
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    }

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const lastBlob = () => createObjectURL.mock.calls[0][0] as unknown as Blob;

    it('writes the visible rows to a dated CSV with a BOM for Excel', async () => {
        stubObjectUrls();

        const fileName = await exportInventory(
            [
                {
                    quantity: 12,
                    location: 'Rack A',
                    inventoryType: 'DC',
                    barcode: 'BC-1',
                    purchaseDate: '2024-10-15T00:00:00.000Z',
                    product: { name: 'Dog Food', sku: 'SKU-1', minStock: 20, supplier: { name: 'Acme' } },
                    store: { name: 'Main Warehouse' },
                },
            ],
            'csv',
        );

        expect(fileName).toMatch(/^inventory-\d{4}-\d{2}-\d{2}\.csv$/);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');

        const text = await lastBlob().text();
        expect(text.startsWith('\uFEFF')).toBe(true);
        expect(text).toContain('Dog Food');
        expect(text).toContain('Distribution Center');
        expect(text).toContain('Low Stock');
        expect(text).toContain('Acme');
    });

    it('writes a real .xlsx workbook', async () => {
        stubObjectUrls();

        const fileName = await exportInventory(
            [{ quantity: 0, product: { name: 'Cat Food', sku: 'SKU-2' } }],
            'xlsx',
        );

        expect(fileName).toMatch(/^inventory-\d{4}-\d{2}-\d{2}\.xlsx$/);
        expect(lastBlob().type).toContain('spreadsheetml');
        expect((await lastBlob().arrayBuffer()).byteLength).toBeGreaterThan(0);
    });

    it('downloads the template with exactly the importable headers', async () => {
        stubObjectUrls();

        const fileName = await downloadImportTemplate('csv');

        expect(fileName).toBe('inventory-import-template.csv');
        const text = await lastBlob().text();

        for (const header of TEMPLATE_HEADERS) {
            expect(text).toContain(header);
        }
        // Export-only columns must not come back through the template.
        expect(text).not.toContain('Barcode');
        expect(text).not.toContain('Status');
    });

    it('defaults the template to .xlsx', async () => {
        stubObjectUrls();

        await expect(downloadImportTemplate()).resolves.toBe('inventory-import-template.xlsx');
    });
});


