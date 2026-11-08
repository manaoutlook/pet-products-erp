import { describe, it, expect } from 'vitest';
import {
    EXPORT_COLUMNS,
    INVENTORY_IMPORT_FIELDS,
    mapHeaders,
} from '@/utils/inventory-spreadsheet';

/**
 * Locks the Inventory import/export contract in place: the template headers, the
 * accepted aliases and the exported values all have to agree, otherwise a
 * re-exported file cannot be imported back unchanged.
 */
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

    it('leaves the dates blank when they are not set', () => {
        const purchaseColumn = EXPORT_COLUMNS.find((column) => column.header === 'Purchase Date');

        expect(purchaseColumn!.value({ quantity: 1, purchaseDate: null })).toBe('');
        expect(purchaseColumn!.value({ quantity: 1, purchaseDate: '2024-10-15' })).toBe('2024-10-15');
    });
});
