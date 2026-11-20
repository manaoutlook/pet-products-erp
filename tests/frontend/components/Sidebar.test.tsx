import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '@/components/Layout/Sidebar';

/**
 * The sidebar's contract, in the order it fixes things:
 *
 * - the rows read in the order the shop works (daily block, then the setup sections);
 * - a folded section reveals itself when the current page is inside it, and an open
 *   section stays open across reloads;
 * - what a role may not open is not offered, heading included;
 * - the active row is marked, deep links included (`/finance/ledger` -> Financial Accounts).
 */

const locationState = vi.hoisted(() => ({ value: '/' }));

vi.mock('wouter', () => ({
    // wouter 3 renders the anchor itself and spreads the remaining props onto it, so the
    // mock must do the same - otherwise `href` and `aria-current` never reach the DOM.
    Link: ({ href, children, ...rest }: { href: string; children: any }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
    useLocation: () => [locationState.value, vi.fn()],
}));

const userState = vi.hoisted(() => ({
    value: { logout: vi.fn(), user: { username: 'admin', role: { name: 'Admin', isSystemAdmin: false } } },
}));

vi.mock('@/hooks/use-user', () => ({
    useUser: () => userState.value,
}));

const permissionsState = vi.hoisted(() => ({
    value: {
        hasPermission: (_module: string, _action: string) => true,
        isAdmin: true,
    } as { hasPermission: (module: string, action: string) => boolean; isAdmin: boolean },
}));

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => permissionsState.value,
}));

vi.mock('@/components/theme-provider', () => ({
    useTheme: () => ({ resolvedTheme: 'dark', toggleTheme: vi.fn() }),
}));

/**
 * Node's experimental `localStorage` global shadows happy-dom's and has no methods (see
 * tests/frontend/theme/theme-provider.test.tsx), so install a plain in-memory Storage.
 */
function installMemoryStorage() {
    const store = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => {
            store.delete(key);
        },
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
    };
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: storage,
    });
}

function linkNames(): string[] {
    const nav = screen.getByRole('navigation');
    return within(nav)
        .getAllByRole('link')
        .map(link => link.textContent?.trim() ?? '');
}

function mockRole(options: { allowed?: string[]; isAdmin?: boolean; systemAdmin?: boolean }) {
    const allowed = new Set(options.allowed ?? []);
    permissionsState.value = {
        hasPermission: (module: string) => allowed.has(module),
        isAdmin: options.isAdmin ?? false,
    };
    userState.value = {
        logout: vi.fn(),
        user: {
            username: 'cashier',
            role: { name: 'Cashier', isSystemAdmin: options.systemAdmin ?? false },
        },
    };
}

describe('Sidebar', () => {
    beforeEach(() => {
        locationState.value = '/';
        installMemoryStorage();
        mockRole({
            allowed: ['products', 'orders', 'inventory', 'users', 'stores', 'masterData', 'pos', 'receipts', 'finance', 'customerProfiles'],
            isAdmin: true,
        });
    });

    it('lists the daily screens in the order the shop works', () => {
        render(<Sidebar />);

        // Till first, and a delivery note follows the sales order it fulfils. Purchase
        // orders come last in the block because they are opened per supplier, not per hour.
        expect(linkNames().slice(0, 5)).toEqual([
            'Dashboard',
            'Point of Sale',
            'Sales Orders',
            'Delivery Notes',
            'Purchase Orders',
        ]);
    });

    it('groups the setup screens into labelled sections, in workflow order', () => {
        render(<Sidebar />);

        const headings = screen
            .getAllByText(/^(Inventory|Money|Master Data|Administration)$/)
            .map(node => node.textContent);

        expect(headings).toEqual(['Inventory', 'Money', 'Master Data', 'Administration']);

        // The daily block comes before any heading, and money sits between stock and setup.
        const names = linkNames();
        expect(names.indexOf('Point of Sale')).toBeLessThan(names.indexOf('Inventory List'));
        expect(names.indexOf('Stock Adjustments')).toBeLessThan(names.indexOf('Receipts'));
        expect(names.indexOf('Financial Accounts')).toBeLessThan(names.indexOf('Products'));
    });

    it('keeps every row flat - no section for a single link', () => {
        locationState.value = '/products';
        render(<Sidebar />);

        // "Products" is a link, not a chevron that hides one child called "Product List".
        const products = screen.getByRole('link', { name: 'Products' });
        expect(products).toHaveAttribute('href', '/products');
        expect(screen.queryByRole('link', { name: 'Product List' })).not.toBeInTheDocument();
        // Regions moved next to the stores they group, not under User Management.
        expect(linkNames()).toContain('Regions');
    });
});

describe('Sidebar sections', () => {
    beforeEach(() => {
        locationState.value = '/';
        installMemoryStorage();
        mockRole({
            allowed: ['products', 'orders', 'inventory', 'users', 'stores', 'masterData', 'pos', 'receipts', 'finance', 'customerProfiles'],
            isAdmin: true,
        });
    });

    it('folds the rarely used sections but opens the one the current page is in', () => {
        locationState.value = '/users';
        render(<Sidebar />);

        const administration = screen.getByRole('button', { name: 'Administration' });

        // Folded by default, yet the page we are on is inside it - so it opens itself.
        expect(administration).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    });

    it('toggles a section and remembers the choice on the next visit', () => {
        const { unmount } = render(<Sidebar />);
        const administration = screen.getByRole('button', { name: 'Administration' });

        expect(administration).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();

        return userEvent.click(administration).then(() => {
            expect(administration).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByRole('link', { name: 'Roles' })).toBeInTheDocument();
            expect(window.localStorage.getItem('erp-sidebar-expanded-sections')).toContain('Administration');

            unmount();

            // A fresh mount (a reload) reads the stored choice instead of the default.
            render(<Sidebar />);
            expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute(
                'aria-expanded',
                'true'
            );
        });
    });

    it('can fold Master Data back down and really closes it', async () => {
        const user = userEvent.setup();
        render(<Sidebar />);

        const masterData = screen.getByRole('button', { name: 'Master Data' });
        expect(masterData).toHaveAttribute('aria-expanded', 'true');

        await user.click(masterData);

        expect(masterData).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();
        expect(window.localStorage.getItem('erp-sidebar-expanded-sections')).not.toContain('Master Data');
    });

    it('ignores a stored label for a section that no longer exists', () => {
        window.localStorage.setItem('erp-sidebar-expanded-sections', JSON.stringify(['Old Section']));
        render(<Sidebar />);

        // Anything unknown is dropped and the defaults stand in.
        expect(screen.getByRole('button', { name: 'Master Data' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('falls back to the defaults when the stored value is not readable', () => {
        window.localStorage.setItem('erp-sidebar-expanded-sections', 'not json');
        render(<Sidebar />);

        expect(screen.getByRole('button', { name: 'Master Data' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('still opens a section when storage refuses to remember it', async () => {
        const user = userEvent.setup();
        render(<Sidebar />);
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        const administration = screen.getByRole('button', { name: 'Administration' });
        await user.click(administration);

        // Storage is a convenience; a full or blocked store must not swallow the click.
        expect(administration).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('Sidebar permissions and active state', () => {
    beforeEach(() => {
        locationState.value = '/';
        installMemoryStorage();
    });

    it('offers a cashier only the screens their role can open', () => {
        mockRole({ allowed: ['pos', 'receipts'] });
        render(<Sidebar />);

        // Dashboard is ungated by design; the money rows come with the receipts permission.
        expect(linkNames()).toEqual(['Dashboard', 'Point of Sale', 'Receipts', 'Receivables']);
        // Sections with nothing left in them are dropped, heading included.
        expect(screen.queryByRole('button', { name: 'Master Data' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
        expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    });

    it('shows a system admin everything even without module grants', () => {
        mockRole({ allowed: [], systemAdmin: true });
        render(<Sidebar />);

        const names = linkNames();
        expect(names).toContain('Inventory List');
        expect(names).toContain('Products');

        // The admin section starts folded, so open it before looking for the admin rows.
        return userEvent.click(screen.getByRole('button', { name: 'Administration' })).then(() => {
            expect(linkNames()).toEqual(
                expect.arrayContaining(['Roles', 'Permissions', 'Store Assignments', 'VAT Companies'])
            );
        });
    });

    it('keeps the admin-only rows away from a non-admin who may open Users', () => {
        mockRole({ allowed: ['users'], isAdmin: false });
        render(<Sidebar />);

        return userEvent.click(screen.getByRole('button', { name: 'Administration' })).then(() => {
            expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Permissions' })).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Store Assignments' })).not.toBeInTheDocument();
        });
    });

    it('marks the current page, including the nested routes behind it', () => {
        mockRole({ allowed: ['finance'] });
        locationState.value = '/finance/ledger';
        render(<Sidebar />);

        // /finance/ledger is the ledger tab of Financial Accounts, not a page of its own.
        expect(screen.getByRole('link', { name: 'Financial Accounts' })).toHaveAttribute(
            'aria-current',
            'page'
        );
        expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    });

    it('does not mark the dashboard for every route', () => {
        mockRole({ allowed: ['pos'] });
        locationState.value = '/pos';
        render(<Sidebar />);

        expect(screen.getByRole('link', { name: 'Point of Sale' })).toHaveAttribute('aria-current', 'page');
        // "/" is a prefix of every path - it must only light up on the dashboard itself.
        expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    });
});
