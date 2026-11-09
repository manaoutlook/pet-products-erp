import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    CompanyHeader,
    CompanyHeaderError,
    CompanyHeaderPreview,
    buildDocumentCompanyHeader,
    companyHeaderMissingFields,
} from '@/components/company/CompanyHeader';
import { COMPANY_FIELDS } from '@shared/company';

/**
 * One letterhead, two renderers.
 *
 * The screen band (`<CompanyHeader />`, mounted once by `MainLayout`) and the printed
 * header (`buildDocumentCompanyHeader`) must stay in lockstep - same fields, same refusal
 * when a field is blank. The paper itself carries the values only: no field labels, no
 * application title. These tests pin that agreement rather than the markup of either one,
 * so restyling the band cannot silently change the paper.
 */

const company = {
    companyName: 'Pet Products Trading Co., Ltd.',
    registeredAddress: '12 Le Loi, District 1, HCMC',
    deliveryAddress: '99 Nguyen Trai, District 5, HCMC',
    taxId: '0312345678',
};

afterEach(() => {
    cleanup();
});

describe('printed company header', () => {
    it('prints the company name, registered address and labelled tax ID, centred', () => {
        const html = buildDocumentCompanyHeader(company);

        expect(html).toContain('class="company-header"');
        expect(html).toContain('class="company-name"');

        // Print order: company name, registered address, then the labelled tax ID.
        const printed = ['companyName', 'registeredAddress', 'taxId'] as const;
        let cursor = -1;
        for (const key of printed) {
            const at = html.indexOf(company[key]);
            expect(at, `${key} value should be printed`).toBeGreaterThan(-1);
            expect(at, `${key} value should follow the previous line`).toBeGreaterThan(cursor);
            cursor = at;
        }

        // The tax ID is the one value that keeps its label.
        expect(html).toContain('Tax ID:');
        expect(html).toContain('company-field-label');

        // Neither the delivery address nor the form-style labels belong on the heading.
        expect(html).not.toContain(company.deliveryAddress);
        expect(html).not.toContain('Delivery Address');
        expect(html).not.toContain('Company Name:');
        expect(html).not.toContain('Registered Address:');
        expect(html).not.toContain('Smart ERP');
    });

    it('escapes values so a company name cannot break the sheet', () => {
        const html = buildDocumentCompanyHeader({
            ...company,
            companyName: 'A & B <Trading>',
        });

        expect(html).toContain('A &amp; B &lt;Trading&gt;');
        expect(html).not.toContain('<Trading>');
    });

    it('refuses to draw a header with blanks, naming what is missing', () => {
        expect(() => buildDocumentCompanyHeader({ ...company, taxId: '   ' })).toThrow(
            CompanyHeaderError
        );

        try {
            buildDocumentCompanyHeader({ ...company, taxId: '   ' });
        } catch (error) {
            expect((error as CompanyHeaderError).missingFields).toEqual(['Tax ID']);
        }
    });

    it('treats "no company row yet" as all four fields missing', () => {
        expect(companyHeaderMissingFields(null)).toEqual(
            COMPANY_FIELDS.map((field) => field.label)
        );
        expect(() => buildDocumentCompanyHeader(null)).toThrow(CompanyHeaderError);
    });
});

describe('screen company header', () => {
    it('shows the same four fields the paper will carry', () => {
        render(<CompanyHeader company={company} />);

        for (const field of COMPANY_FIELDS) {
            expect(screen.getByText(`${field.label}:`)).toBeInTheDocument();
        }

        expect(screen.getByText('Pet Products Trading Co., Ltd.')).toBeInTheDocument();
        expect(screen.getByText('0312345678')).toBeInTheDocument();
        expect(screen.getByText(/Letterhead complete/i)).toBeInTheDocument();
    });

    it('names the blank fields and links to the form that fixes them', () => {
        render(<CompanyHeader company={{ ...company, deliveryAddress: '' }} />);

        expect(screen.getByText(/Missing: Delivery Address/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /complete company profile/i })).toHaveAttribute(
            'href',
            '/company-profile'
        );
    });

    it('hides the setup link on screens that cannot edit the profile', () => {
        render(<CompanyHeader company={null} editable={false} />);

        expect(screen.getByText(/Missing: Company Name, Registered Address, Delivery Address, Tax ID/i))
            .toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /complete company profile/i })).toBeNull();
    });

    it('says the letterhead is loading instead of calling four fields blank', () => {
        render(<CompanyHeader company={null} isLoading />);

        expect(screen.getByText(/Loading letterhead/i)).toBeInTheDocument();
        expect(screen.queryByText(/Missing:/i)).toBeNull();
    });

    it('says the letterhead is unavailable when the fetch failed', () => {
        render(<CompanyHeader company={null} loadError={new Error('relation "company" does not exist')} />);

        expect(screen.getByText(/Letterhead unavailable/i)).toBeInTheDocument();
        expect(screen.queryByText(/Missing:/i)).toBeNull();
        expect(screen.getByRole('link', { name: /complete company profile/i })).toBeInTheDocument();
    });
});

describe('document header preview', () => {
    it('shows unsaved values and marks blank lines instead of hiding them', () => {
        render(<CompanyHeaderPreview company={{ ...company, taxId: '' }} />);

        expect(screen.getByText('Pet Products Trading Co., Ltd.')).toBeInTheDocument();
        expect(screen.getByText('— not set —')).toBeInTheDocument();
    });

    it('matches the paper: centred, delivery address omitted, tax ID labelled', () => {
        const { container } = render(<CompanyHeaderPreview company={company} />);

        expect(container.firstElementChild?.className).toContain('text-center');

        expect(screen.getByText(company.companyName)).toBeInTheDocument();
        expect(screen.getByText(company.registeredAddress)).toBeInTheDocument();
        expect(screen.getByText(company.taxId)).toBeInTheDocument();
        expect(screen.getByText(/Tax ID:/)).toBeInTheDocument();

        // Not part of the heading, and no form-style labels other than the tax ID.
        expect(screen.queryByText(company.deliveryAddress)).toBeNull();
        expect(screen.queryByText(/Company Name:/)).toBeNull();
        expect(screen.queryByText(/Registered Address:/)).toBeNull();
    });
});
