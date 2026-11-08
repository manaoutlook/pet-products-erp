import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequirePermission } from '@/components/auth/RequirePermission';

const permissionsState = vi.hoisted(() => ({
    value: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/use-permissions', () => ({
    usePermissions: () => permissionsState.value,
}));

function mockPermissions(overrides: Record<string, unknown>) {
    permissionsState.value = {
        can: () => false,
        hasPermission: () => false,
        getModulePermissions: () => null,
        getAllowedModules: () => [],
        isAdmin: false,
        role: undefined,
        isLoading: false,
        ...overrides,
    };
}

describe('RequirePermission', () => {
    beforeEach(() => {
        mockPermissions({});
    });

    it('renders the page when the role grants the module action', () => {
        mockPermissions({ can: (module: string, action: string) => module === 'inventory' && action === 'read' });

        render(
            <RequirePermission module="inventory" action="read">
                <p>inventory list</p>
            </RequirePermission>
        );

        expect(screen.getByText('inventory list')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows an access-denied explanation when the permission is missing', () => {
        render(
            <RequirePermission module="users" action="read">
                <p>user management</p>
            </RequirePermission>
        );

        const denied = screen.getByRole('alert');
        expect(denied).toHaveTextContent('Access denied');
        expect(denied).toHaveTextContent('users read permission');
        // The page itself must not mount: it would fire requests the API rejects.
        expect(screen.queryByText('user management')).not.toBeInTheDocument();
    });

    it('waits instead of denying while the role is still loading', () => {
        mockPermissions({ isLoading: true });

        render(
            <RequirePermission module="users" action="read">
                <p>user management</p>
            </RequirePermission>
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByText('user management')).not.toBeInTheDocument();
    });

    it('gates admin-only screens on the admin flag, not on a module permission', () => {
        mockPermissions({ can: () => true, isAdmin: false });

        const { unmount } = render(
            <RequirePermission module="users" action="read" adminOnly>
                <p>roles</p>
            </RequirePermission>
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
        unmount();

        mockPermissions({ can: () => false, isAdmin: true });
        render(
            <RequirePermission module="users" action="read" adminOnly>
                <p>roles</p>
            </RequirePermission>
        );
        expect(screen.getByText('roles')).toBeInTheDocument();
    });
});
