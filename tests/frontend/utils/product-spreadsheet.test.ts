import { describe, it, expect } from 'vitest';
import {
    EXPORT_COLUMNS,
    PRODUCT_IMPORT_FIELDS,
    mapHeaders,
} from '@/utils/product-spreadsheet';

/**
 * The product weight is recorded in kilograms. These tests lock the unit in
 * place: the template/export header, the accepted aliases and the exported
 * value all have to agree, otherwise an import silently rescales the weight.
 */
describe('product-spreadsheet - weight unit (kg)', () => {
    it('lists the weight template column in kilograms', () => {
        const weightField = PRODUCT_IMPORT_FIELDS.find((field) => field.key === 'weightKg');

        expect(weightField).toBeDefined();
        expect(weightField?.label).toBe('Weight (kg)');
    });

    it('maps the template headers back onto the import fields', () => {
        const templateHeaders = PRODUCT_IMPORT_FIELDS.map((field) => field.label);
        const { missingRequired, unmatched } = mapHeaders(templateHeaders);

        expect(missingRequired).toEqual([]);
        expect(unmatched).toEqual([]);
    });

    it('maps a "Weight (kg)" column to weightKg', () => {
        const { fields, unmatched } = mapHeaders([
            'Name',
            'SKU',
            'Category',
            'Supplier',
            'B2C Price',
            'Weight (kg)',
        ]);

        expect(fields.weightKg).toBe(5);
        expect(unmatched).toEqual([]);
    });

    it('treats a bare "Weight" column as kilograms', () => {
        const { fields } = mapHeaders(['Weight']);

        expect(fields.weightKg).toBe(0);
    });

    it('does not read gram headers as kilograms', () => {
        const { fields, unmatched } = mapHeaders(['Weight (g)', 'Weight (kg)']);

        // Only the kg column is used; the gram column is reported as unknown so
        // the user notices the mismatch instead of importing a 1000x weight.
        expect(fields.weightKg).toBe(1);
        expect(unmatched).toEqual(['Weight (g)']);
    });

    it('exports the stored kilograms unchanged', () => {
        const weightColumn = EXPORT_COLUMNS.find((column) => column.header === 'Weight (kg)');

        expect(weightColumn).toBeDefined();
        expect(
            weightColumn!.value({
                name: 'Sample',
                sku: 'SAMPLE-001',
                weightKg: '0.350',
            })
        ).toBe(0.35);
        expect(weightColumn!.value({ name: 'Sample', sku: 'SAMPLE-002', weightKg: null })).toBe('');
    });
});
