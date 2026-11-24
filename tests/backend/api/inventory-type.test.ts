import { describe, it, expect } from 'vitest';
import { inventoryTypeForStore } from '../../../server/inventory-type';

describe('inventoryTypeForStore', () => {
    it('stores warehouse stock as DC, even though it has a store id', () => {
        // Vinod House is a WAREHOUSE: the export used to call its stock "Retail Store".
        expect(inventoryTypeForStore('WAREHOUSE')).toBe('DC');
    });

    it('stores shop stock as STORE', () => {
        expect(inventoryTypeForStore('RETAIL')).toBe('STORE');
    });

    it('treats a missing store (central DC) as DC', () => {
        expect(inventoryTypeForStore(null)).toBe('DC');
        expect(inventoryTypeForStore(undefined)).toBe('DC');
    });
});
