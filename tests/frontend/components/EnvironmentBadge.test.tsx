import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EnvironmentBadge, EnvironmentNotice } from '@/components/Layout/EnvironmentBadge';
import { environmentInfo, resolveEnvironmentName } from '@shared/environment';

/**
 * "Which system am I on?" is the one label a user must not get wrong: the wrong answer
 * means a real stock adjustment typed into a copy, or a "test" deletion on the live
 * books. These tests pin the three things that carry that answer:
 *
 * - an unset or misspelled APP_ENV is `unknown`, never quietly `production`;
 * - the badge and the login banner read the same server answer;
 * - production stays quiet (no alert panel, no tab prefix) while every other
 *   environment is loud.
 */

const environmentState = vi.hoisted(() => ({
    value: {
        info: {} as unknown,
        host: null as string | null,
        isLoading: false,
        isError: false,
    },
}));

vi.mock('@/hooks/use-environment', () => ({
    useEnvironment: () => environmentState.value,
}));

function useEnvironment(name: string, host: string | null = 'localhost:5002') {
    environmentState.value = {
        info: environmentInfo(name),
        host,
        isLoading: false,
        isError: false,
    };
}

afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.env;
    document.title = 'Smart ERP';
});

describe('resolveEnvironmentName', () => {
    it('maps the values a .env may actually contain', () => {
        expect(resolveEnvironmentName('production')).toBe('production');
        expect(resolveEnvironmentName('PROD')).toBe('production');
        expect(resolveEnvironmentName(' staging ')).toBe('staging');
        expect(resolveEnvironmentName('stage')).toBe('staging');
        expect(resolveEnvironmentName('uat')).toBe('staging');
        expect(resolveEnvironmentName('development')).toBe('development');
        expect(resolveEnvironmentName('local')).toBe('development');
    });

    it('treats unset, empty and misspelled values as unknown rather than production', () => {
        // Safety direction: a live box labelled "Staging" invites destructive testing, so
        // the fallback must never be the reassuring answer.
        expect(resolveEnvironmentName(undefined)).toBe('unknown');
        expect(resolveEnvironmentName(null)).toBe('unknown');
        expect(resolveEnvironmentName('')).toBe('unknown');
        expect(resolveEnvironmentName('stagin')).toBe('unknown');
        expect(resolveEnvironmentName(42)).toBe('unknown');
        expect(environmentInfo(undefined).isProduction).toBe(false);
    });
});

describe('EnvironmentBadge', () => {
    it('names the environment in the corner and marks the document for the top strip', () => {
        useEnvironment('staging');
        document.title = 'Smart ERP';

        render(<EnvironmentBadge />);

        const badge = screen.getByTestId('environment-badge');
        expect(badge).toHaveTextContent('STAGE');
        expect(badge).toHaveAttribute('data-environment', 'staging');
        expect(document.documentElement.dataset.env).toBe('staging');
        // The tab title is what survives a screenshot of the browser chrome.
        expect(document.title).toBe('STAGING · Smart ERP');
    });

    it('leaves the tab title alone on production', () => {
        useEnvironment('production', 'erp.smartlife-vn.com');
        document.title = 'Smart ERP';

        render(<EnvironmentBadge />);

        expect(screen.getByTestId('environment-badge')).toHaveTextContent('PROD');
        expect(document.title).toBe('Smart ERP');
        expect(document.documentElement.dataset.env).toBe('production');
    });

    it('does not double-prefix the title when the environment is shown twice', () => {
        useEnvironment('development');
        document.title = 'Smart ERP';

        const { unmount } = render(<EnvironmentBadge />);
        unmount();
        render(<EnvironmentNotice />);

        expect(document.title).toBe('DEV · Smart ERP');
    });

    it('renders nothing while the server answer is still in flight', () => {
        // A badge that says STAGE and flips to PROD a moment later is worse than nothing.
        environmentState.value = {
            info: environmentInfo(undefined),
            host: null,
            isLoading: true,
            isError: false,
        };

        render(<EnvironmentBadge />);

        expect(screen.queryByTestId('environment-badge')).toBeNull();
    });
});

describe('EnvironmentNotice (login screen)', () => {
    it('warns on staging and names the host', () => {
        useEnvironment('staging', 'localhost:5002');

        render(<EnvironmentNotice />);

        const notice = screen.getByTestId('environment-notice');
        expect(notice).toHaveAttribute('data-environment', 'staging');
        expect(notice).toHaveTextContent('Staging - not the live system');
        expect(notice).toHaveTextContent('localhost:5002');
    });

    it('states production plainly, without an alert panel', () => {
        useEnvironment('production', 'erp.smartlife-vn.com');

        render(<EnvironmentNotice />);

        const notice = screen.getByTestId('environment-notice');
        expect(notice).toHaveAttribute('data-environment', 'production');
        expect(notice).toHaveTextContent('Production');
        expect(notice).toHaveTextContent('erp.smartlife-vn.com');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shouts when APP_ENV is unset', () => {
        useEnvironment('unknown', null);

        render(<EnvironmentNotice />);

        expect(screen.getByRole('alert')).toHaveTextContent('Environment unknown');
        expect(screen.getByRole('alert')).toHaveTextContent('APP_ENV');
    });
});
