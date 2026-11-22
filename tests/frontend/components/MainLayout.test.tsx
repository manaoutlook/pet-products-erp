import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import MainLayout from '@/components/Layout/MainLayout';

/**
 * Route changes reuse the same shell, so the scroll position must be reset
 * whenever the location changes. Without this a screen opened from the bottom
 * of a long page appears blank until the user scrolls back up.
 */

const locationState = vi.hoisted(() => ({ value: '/users' }));

vi.mock('wouter', () => ({
    useLocation: () => [locationState.value, vi.fn()],
}));

vi.mock('@/components/Layout/Sidebar', () => ({
    default: () => <nav aria-label="Main" />,
}));

vi.mock('@/components/company/CompanyHeader', () => ({
    CompanyHeader: () => null,
}));

vi.mock('@/hooks/use-company', () => ({
    useCompanyInfo: () => ({ company: null, isLoading: false, isError: false, error: null }),
}));

describe('MainLayout scroll restoration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        locationState.value = '/users';
    });

    it('starts every screen at the top after navigating', () => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

        const { rerender } = render(
            <MainLayout>
                <div>Users</div>
            </MainLayout>
        );

        const main = document.querySelector('main')!;
        main.scrollTop = 480;
        main.scrollLeft = 0;

        locationState.value = '/store-assignments';
        rerender(
            <MainLayout>
                <div>Store Assignments</div>
            </MainLayout>
        );

        expect(main.scrollTop).toBe(0);
        expect(main.scrollLeft).toBe(0);
        expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    });
});
