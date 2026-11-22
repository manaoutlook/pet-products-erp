import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RolePermissionsPage from '@/pages/RolePermissionsPage';

// Avoid rendering the real toast provider
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

/**
 * Role Permissions - the VAT Margin Calculator, VAT Companies and Company Profile columns.
 *
 * Each of these screens is granted on its own: VAT Margin so Orders access never implies the
 * partner's profit split, VAT Companies so Suppliers/Brands (master data) never imply the legal
 * entities that issue VAT invoices, Company Profile so master data never implies rewriting the
 * letterhead every document prints. That promise is only kept if two things hold: the module
 * appears in the matrix, and it offers exactly the switches the screen uses. A switch with nothing
 * behind it would be a lie - the VAT Margin and Company Profile screens have nothing to create or
 * delete (View, Edit), the VAT Companies screen has no delete (View, Create, Edit).
 */

const fullPermission = { create: true, read: true, update: true, delete: true };
const noPermission = { create: false, read: false, update: false, delete: false };

const allTruePermissions = {
    products: fullPermission,
    orders: fullPermission,
    vatMargin: fullPermission,
    inventory: fullPermission,
    users: fullPermission,
    stores: fullPermission,
    masterData: fullPermission,
    vatCompanies: fullPermission,
    companyProfile: fullPermission,
    pos: fullPermission,
    receipts: fullPermission,
    finance: fullPermission,
    customerProfiles: fullPermission,
};

interface RoleFixture {
    id: number;
    name: string;
    description: string;
    isSystemAdmin: boolean;
    permissions: typeof allTruePermissions;
}

function buildRoleFixtures(): RoleFixture[] {
    return [
        {
            id: 1,
            name: 'admin',
            description: 'System Administrator',
            isSystemAdmin: true,
            permissions: allTruePermissions,
        },
        {
            id: 2,
            name: 'store_manager',
            description: 'Store Manager',
            isSystemAdmin: false,
            permissions: {
                ...allTruePermissions,
                vatMargin: noPermission,
                vatCompanies: noPermission,
                companyProfile: noPermission,
            },
        },
    ];
}

let roleFixtures: RoleFixture[];

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
}

const fetchMock = vi.fn();

function renderPage() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: Infinity,
                queryFn: async ({ queryKey }) => {
                    const res = await fetch(queryKey[0] as string, { credentials: 'include' });
                    return res.json();
                },
            },
            mutations: { retry: false },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <RolePermissionsPage />
        </QueryClientProvider>
    );
}

/** The body cell sitting under the VAT Margin Calculator column, for one role row. */
function vatMarginCell(roleRowIndex: number) {
    const header = screen.getByRole('columnheader', { name: 'VAT Margin Calculator Module' });
    const row = screen.getAllByRole('row')[roleRowIndex];
    return within(row).getAllByRole('cell')[header.cellIndex] as HTMLElement;
}

/** The body cell sitting under the VAT Companies column, for one role row. */
function vatCompaniesCell(roleRowIndex: number) {
    const header = screen.getByRole('columnheader', { name: 'VAT Companies Module' });
    const row = screen.getAllByRole('row')[roleRowIndex];
    return within(row).getAllByRole('cell')[header.cellIndex] as HTMLElement;
}

/** The body cell sitting under the Company Profile column, for one role row. */
function companyProfileCell(roleRowIndex: number) {
    const header = screen.getByRole('columnheader', { name: 'Company Profile Module' });
    const row = screen.getAllByRole('row')[roleRowIndex];
    return within(row).getAllByRole('cell')[header.cellIndex] as HTMLElement;
}

describe('RolePermissionsPage - VAT Margin Calculator module', () => {
    beforeEach(() => {
        roleFixtures = buildRoleFixtures();
        toastMock.mockClear();
        fetchMock.mockReset();
        fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/roles' && (!init || !init.method)) {
                return jsonResponse(roleFixtures);
            }
            if (url === '/api/roles/2/permissions' && init?.method === 'PUT') {
                return jsonResponse({ success: true });
            }
            throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists the module with only the View and Edit switches', async () => {
        renderPage();

        // Row 0 is the header, row 1 is admin, row 2 is store_manager.
        const cell = await waitFor(() => vatMarginCell(2));

        const switches = within(cell).getAllByRole('switch');
        expect(switches).toHaveLength(2);
        expect(within(cell).getByText('View')).toBeInTheDocument();
        expect(within(cell).getByText('Edit')).toBeInTheDocument();
        expect(within(cell).queryByText('Create')).not.toBeInTheDocument();
        expect(within(cell).queryByText('Delete')).not.toBeInTheDocument();
    });

    it('saves a View grant under the vatMargin module', async () => {
        const user = userEvent.setup();
        renderPage();

        const cell = await waitFor(() => vatMarginCell(2));
        const viewSwitch = within(cell).getAllByRole('switch')[0];
        expect(viewSwitch).not.toBeChecked();

        await user.click(viewSwitch);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/roles/2/permissions',
                expect.objectContaining({ method: 'PUT' })
            );
        });

        const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
        const body = JSON.parse(String(putCall?.[1]?.body));

        expect(body.permissions.vatMargin).toEqual({
            create: false,
            read: true,
            update: false,
            delete: false,
        });
        // The rest of the role's grants travel with it - a partial map would erase them.
        expect(body.permissions.orders).toEqual(fullPermission);
    });

    it('shows the View and Edit grants a role already holds', async () => {
        roleFixtures[1].permissions = {
            ...allTruePermissions,
            vatMargin: { create: false, read: true, update: true, delete: false },
        };

        renderPage();

        const cell = await waitFor(() => vatMarginCell(2));
        const [viewSwitch, editSwitch] = within(cell).getAllByRole('switch');

        expect(viewSwitch).toBeChecked();
        expect(editSwitch).toBeChecked();
    });
});

describe('RolePermissionsPage - VAT Companies module', () => {
    beforeEach(() => {
        roleFixtures = buildRoleFixtures();
        toastMock.mockClear();
        fetchMock.mockReset();
        fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/roles' && (!init || !init.method)) {
                return jsonResponse(roleFixtures);
            }
            if (url === '/api/roles/2/permissions' && init?.method === 'PUT') {
                return jsonResponse({ success: true });
            }
            throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists the module with only the View, Create and Edit switches', async () => {
        renderPage();

        // Row 0 is the header, row 1 is admin, row 2 is store_manager.
        const cell = await waitFor(() => vatCompaniesCell(2));

        const switches = within(cell).getAllByRole('switch');
        expect(switches).toHaveLength(3);
        expect(within(cell).getByText('View')).toBeInTheDocument();
        expect(within(cell).getByText('Create')).toBeInTheDocument();
        expect(within(cell).getByText('Edit')).toBeInTheDocument();
        expect(within(cell).queryByText('Delete')).not.toBeInTheDocument();
    });

    it('saves a Create grant under the vatCompanies module', async () => {
        const user = userEvent.setup();
        renderPage();

        const cell = await waitFor(() => vatCompaniesCell(2));
        // View, Create, Edit - the badge opens a company and starts its invoice sequence.
        const createSwitch = within(cell).getAllByRole('switch')[1];
        expect(createSwitch).not.toBeChecked();

        await user.click(createSwitch);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/roles/2/permissions',
                expect.objectContaining({ method: 'PUT' })
            );
        });

        const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
        const body = JSON.parse(String(putCall?.[1]?.body));

        expect(body.permissions.vatCompanies).toEqual({
            create: true,
            read: false,
            update: false,
            delete: false,
        });
        // Suppliers/Brands (masterData) travel untouched - the two grants are independent.
        expect(body.permissions.masterData).toEqual(fullPermission);
    });

    it('shows the View and Edit grants a role already holds', async () => {
        roleFixtures[1].permissions = {
            ...allTruePermissions,
            vatCompanies: { create: false, read: true, update: true, delete: false },
        };

        renderPage();

        const cell = await waitFor(() => vatCompaniesCell(2));
        const [viewSwitch, createSwitch, editSwitch] = within(cell).getAllByRole('switch');

        expect(viewSwitch).toBeChecked();
        expect(createSwitch).not.toBeChecked();
        expect(editSwitch).toBeChecked();
    });
});

describe('RolePermissionsPage - Company Profile module', () => {
    beforeEach(() => {
        roleFixtures = buildRoleFixtures();
        toastMock.mockClear();
        fetchMock.mockReset();
        fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/roles' && (!init || !init.method)) {
                return jsonResponse(roleFixtures);
            }
            if (url === '/api/roles/2/permissions' && init?.method === 'PUT') {
                return jsonResponse({ success: true });
            }
            throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists the module with only the View and Edit switches', async () => {
        renderPage();

        // Row 0 is the header, row 1 is admin, row 2 is store_manager.
        const cell = await waitFor(() => companyProfileCell(2));

        const switches = within(cell).getAllByRole('switch');
        expect(switches).toHaveLength(2);
        expect(within(cell).getByText('View')).toBeInTheDocument();
        expect(within(cell).getByText('Edit')).toBeInTheDocument();
        // There is one company row, so there is nothing to create and nothing to delete.
        expect(within(cell).queryByText('Create')).not.toBeInTheDocument();
        expect(within(cell).queryByText('Delete')).not.toBeInTheDocument();
    });

    it('saves an Edit grant under the companyProfile module', async () => {
        const user = userEvent.setup();
        renderPage();

        const cell = await waitFor(() => companyProfileCell(2));
        // View, Edit - Edit is what rewrites the letterhead every document prints.
        const editSwitch = within(cell).getAllByRole('switch')[1];
        expect(editSwitch).not.toBeChecked();

        await user.click(editSwitch);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/roles/2/permissions',
                expect.objectContaining({ method: 'PUT' })
            );
        });

        const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
        const body = JSON.parse(String(putCall?.[1]?.body));

        expect(body.permissions.companyProfile).toEqual({
            create: false,
            read: false,
            update: true,
            delete: false,
        });
        // Master Data travels untouched - the two grants are independent.
        expect(body.permissions.masterData).toEqual(fullPermission);
    });

    it('shows the View and Edit grants a role already holds', async () => {
        roleFixtures[1].permissions = {
            ...allTruePermissions,
            companyProfile: { create: false, read: true, update: false, delete: false },
        };

        renderPage();

        const cell = await waitFor(() => companyProfileCell(2));
        const [viewSwitch, editSwitch] = within(cell).getAllByRole('switch');

        expect(viewSwitch).toBeChecked();
        expect(editSwitch).not.toBeChecked();
    });
});

