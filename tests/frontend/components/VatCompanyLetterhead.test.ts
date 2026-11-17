import { describe, it, expect } from 'vitest';
import {
    documentVatCompanyLetterhead,
    vatCompanyLetterhead,
    vatCompanyMissingFields,
} from '@shared/vat-company';

/**
 * The VAT company letterhead.
 *
 * A VAT sales order / delivery note / invoice prints the licensed company's block instead of
 * the shop's Company Profile. These tests pin the mapping (name, tax code, address) and the
 * fallback rule, because a missing tax code must block printing rather than print a blank.
 */

const vatCompany = {
    name: 'Conqueror International',
    taxId: '0312362838',
    address: '12 Nguyen Hue, District 1, HCMC',
};

const shopCompany = {
    companyName: 'Pet Products Trading Co., Ltd.',
    registeredAddress: '99 Le Loi, District 1, HCMC',
    deliveryAddress: '99 Le Loi, District 1, HCMC',
    taxId: '0312345678',
};

describe('vatCompanyLetterhead', () => {
    it('maps name, address and tax code onto the shared letterhead shape', () => {
        expect(vatCompanyLetterhead(vatCompany)).toEqual({
            companyName: 'Conqueror International',
            registeredAddress: '12 Nguyen Hue, District 1, HCMC',
            // The delivery address is not printed, but the shared completeness rule checks it.
            deliveryAddress: '12 Nguyen Hue, District 1, HCMC',
            taxId: '0312362838',
        });
    });

    it('returns null when there is no company at all', () => {
        expect(vatCompanyLetterhead(null)).toBeNull();
        expect(vatCompanyLetterhead({ name: '  ', taxId: '', address: '' })).toBeNull();
    });

    it('lists the blank seller fields in print order', () => {
        expect(vatCompanyMissingFields({ name: 'CI', taxId: '', address: '' })).toEqual([
            'Tax code',
            'Address',
        ]);
        expect(vatCompanyMissingFields(vatCompany)).toEqual([]);
    });
});

describe('documentVatCompanyLetterhead', () => {
    it('prefers the VAT company snapshot over the shop letterhead', () => {
        expect(documentVatCompanyLetterhead(vatCompany, shopCompany)).toMatchObject({
            companyName: 'Conqueror International',
            taxId: '0312362838',
        });
    });

    it('falls back to the Company Profile when the document has no VAT company', () => {
        expect(documentVatCompanyLetterhead(null, shopCompany)).toBe(shopCompany);
        expect(
            documentVatCompanyLetterhead({ name: '', taxId: '', address: '' }, shopCompany)
        ).toBe(shopCompany);
    });
});
