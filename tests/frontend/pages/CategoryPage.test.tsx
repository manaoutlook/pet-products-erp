import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategoryPage from '@/pages/CategoryPage';

// Permissions are not under test here - always allow everything
vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => ({
        hasPermission: () => true,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
    }),
}));

// Avoid rendering the real toast provider
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

const now = new Date('2024-01-01T00:00:00.000Z').toISOString();

const categories = [
    {
        id: 1,
        name: 'Dogs',
        description: 'Dog products',
        parentId: null as number | null,
        createdAt: now,
        updatedAt: now,
    },
    {
        id: 2,
        name: 'Food',
        description: 'Food products',
        parentId: null as number | null,
        createdAt: now,
        updatedAt: now,
    },
];

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
}

function errorResponse(status: number, data: unknown) {
    return Promise.resolve({
        ok: false,
        status,
        json: async () => data,
        text: async () => JSON.stringify(data),
    } as Response);
}

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
            <CategoryPage />
        </QueryClientProvider>
    );
}

describe('CategoryPage - Edit Category parent category', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Radix UI primitives rely on these DOM APIs which happy-dom does not fully implement
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        let serverCategories = categories.map((category) => ({ ...category }));

        fetchMock = vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === 'PUT') {
                const body = JSON.parse(init.body as string);
                serverCategories = serverCategories.map((category) =>
                    category.id === 2 ? { ...category, parentId: Number(body.parentId) } : category
                );
                const updated = serverCategories.find((category) => category.id === 2);
                return jsonResponse({
                    message: 'Category updated successfully',
                    category: updated,
                });
            }

            return jsonResponse(serverCategories);
        });

        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows the newly selected parent category after updating', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Food');

        // Open the edit dialog of the "Food" category
        const foodRow = screen.getByText('Food').closest('tr') as HTMLTableRowElement;
        const rowButtons = within(foodRow).getAllByRole('button');
        await user.click(rowButtons[1]);

        const dialog = await screen.findByRole('dialog');
        const parentSelect = within(dialog).getByRole('combobox');
        await user.click(parentSelect);

        // Pick a new parent category
        const dogsOption = await screen.findByRole('option', { name: 'Dogs' });
        await user.click(dogsOption);

        await user.click(within(dialog).getByRole('button', { name: /update category/i }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/categories/2',
                expect.objectContaining({ method: 'PUT' })
            );
        });

        const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(JSON.parse(putCall![1].body as string).parentId).toBe('1');

        // The edit dialog should be closed after a successful update
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        // The list should now show the new parent category
        const updatedFoodRow = screen.getByText('Food').closest('tr') as HTMLTableRowElement;
        expect(within(updatedFoodRow).getByText('Dogs')).toBeInTheDocument();
    });
});

describe('CategoryPage - Add Category dialog', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        let serverCategories = categories.map((category) => ({ ...category }));

        fetchMock = vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === 'POST') {
                const body = JSON.parse(init.body as string);
                const created = {
                    id: serverCategories.length + 1,
                    name: body.name,
                    description: body.description || '',
                    parentId: body.parentId ? Number(body.parentId) : null,
                    createdAt: now,
                    updatedAt: now,
                };
                serverCategories = [...serverCategories, created];
                return jsonResponse({
                    message: 'Category created successfully',
                    category: created,
                });
            }

            return jsonResponse(serverCategories);
        });

        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts with empty fields after a category has been edited', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Food');

        // Edit "Food" first - the edited values used to leak into the create form
        const foodRow = screen.getByText('Food').closest('tr') as HTMLTableRowElement;
        await user.click(within(foodRow).getAllByRole('button')[1]);

        const editDialog = await screen.findByRole('dialog');
        expect((within(editDialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Food');

        await user.click(within(editDialog).getByRole('button', { name: /close/i }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        // The create dialog must be blank
        await user.click(screen.getByRole('button', { name: /add category/i }));
        const addDialog = await screen.findByRole('dialog');

        expect(within(addDialog).getByText('Add New Category')).toBeInTheDocument();
        expect((within(addDialog).getByLabelText('Name') as HTMLInputElement).value).toBe('');
        expect((within(addDialog).getByLabelText('Description') as HTMLInputElement).value).toBe('');
        expect(within(addDialog).getByRole('combobox')).toHaveTextContent(
            'No parent (Root category)'
        );
    });

    it('clears the fields when the dialog is cancelled and reopened', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Food');

        await user.click(screen.getByRole('button', { name: /add category/i }));
        let dialog = await screen.findByRole('dialog');

        await user.type(within(dialog).getByLabelText('Name'), 'Paper Clips');
        await user.type(within(dialog).getByLabelText('Description'), 'Durable paper clips');

        await user.click(within(dialog).getByRole('button', { name: /close/i }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: /add category/i }));
        dialog = await screen.findByRole('dialog');

        expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('');
        expect((within(dialog).getByLabelText('Description') as HTMLInputElement).value).toBe('');
    });

    it('closes and clears the form after a successful create', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Food');

        await user.click(screen.getByRole('button', { name: /add category/i }));
        const dialog = await screen.findByRole('dialog');

        await user.type(within(dialog).getByLabelText('Name'), 'Paper Clips');
        await user.click(within(dialog).getByRole('button', { name: /create category/i }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/categories',
                expect.objectContaining({ method: 'POST' })
            );
        });

        // The dialog must close after the successful create
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        // ...and reopening it must show a blank form
        await user.click(screen.getByRole('button', { name: /add category/i }));
        const reopened = await screen.findByRole('dialog');
        expect((within(reopened).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    });
});

describe('CategoryPage - Search', () => {
    const NARROW_NO_BREAK_SPACE = '\u202f';

    const searchCategories = [
        {
            id: 26,
            name: 'Grooming Tools',
            description:
                "Explore SmartLife VN's Grooming Tools collection - precision trimmers, rechargeable devices, and smart grooming accessories designed for effortless personal care.",
            parentId: 25,
            createdAt: now,
            updatedAt: now,
        },
        {
            // Name stored with U+202F instead of a regular space (copy-pasted data)
            id: 28,
            name: `Smart${NARROW_NO_BREAK_SPACE}Gadgets`,
            description: null,
            parentId: 27,
            createdAt: now,
            updatedAt: now,
        },
    ];

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;

        vi.stubGlobal('fetch', vi.fn(() => jsonResponse(searchCategories)));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('matches category names that contain narrow no-break spaces', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Grooming Tools');

        await user.type(screen.getByPlaceholderText('Search categories...'), 'Smart G');

        // The category whose name uses U+202F must still be found with a plain space
        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            expect(within(rows[rows.length - 1]).getByText(/Smart.Gadgets/)).toBeInTheDocument();
        });

        // "Grooming Tools" only matches on the description, which is also fine
        expect(screen.getByText('Grooming Tools')).toBeInTheDocument();
    });

    it('shows every category when the search box is cleared', async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Grooming Tools');

        const searchInput = screen.getByPlaceholderText('Search categories...');
        await user.type(searchInput, 'Smart G');
        await waitFor(() => {
            expect(screen.queryByText('Smart Devices')).not.toBeInTheDocument();
        });

        await user.clear(searchInput);
        await waitFor(() => {
            expect(screen.getByText(/Smart.Gadgets/)).toBeInTheDocument();
            expect(screen.getByText('Grooming Tools')).toBeInTheDocument();
        });
    });
});

describe('CategoryPage - Delete Category validation', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
        Element.prototype.setPointerCapture = vi.fn() as any;
        Element.prototype.releasePointerCapture = vi.fn() as any;
        Element.prototype.scrollIntoView = vi.fn() as any;
        toastMock.mockClear();

        vi.stubGlobal('confirm', vi.fn(() => true));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shows the server message when the category has sub categories', async () => {
        const message =
            'Cannot delete category "Dog Food" because sub category "Puppy Food" exists. Please delete or move this sub category first.';

        fetchMock = vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === 'DELETE') {
                return errorResponse(409, {
                    code: 'CATEGORY_HAS_SUB_CATEGORIES',
                    message,
                    subCategoryCount: 1,
                    subCategories: ['Puppy Food'],
                });
            }
            return jsonResponse(categories);
        });
        vi.stubGlobal('fetch', fetchMock);

        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Food');

        const foodRow = screen.getByText('Food').closest('tr') as HTMLTableRowElement;
        const rowButtons = within(foodRow).getAllByRole('button');
        await user.click(rowButtons[rowButtons.length - 1]);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/categories/2',
                expect.objectContaining({ method: 'DELETE' })
            );
        });

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Cannot Delete Category',
                    description: message,
                    variant: 'destructive',
                })
            );
        });
    });

    it('shows the server message when products are associated to the category', async () => {
        const message =
            'Cannot delete category "Food" because 2 products are associated to this category ("Pedigree Adult", "Whiskas Tuna"). Please remove the product associations first.';

        fetchMock = vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === 'DELETE') {
                return errorResponse(409, {
                    code: 'CATEGORY_HAS_PRODUCTS',
                    message,
                    productCount: 2,
                    products: ['Pedigree Adult', 'Whiskas Tuna'],
                });
            }
            return jsonResponse(categories);
        });
        vi.stubGlobal('fetch', fetchMock);

        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Food');

        const foodRow = screen.getByText('Food').closest('tr') as HTMLTableRowElement;
        const rowButtons = within(foodRow).getAllByRole('button');
        await user.click(rowButtons[rowButtons.length - 1]);

        await waitFor(() => {
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Cannot Delete Category',
                    description: message,
                    variant: 'destructive',
                })
            );
        });
    });
});
