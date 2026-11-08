import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/components/theme-provider';

/**
 * Smart ERP ships a light and a dark theme built from the exact same token
 * names (see client/src/index.css). The provider only flips the `dark` class
 * on <html> and remembers the choice, so these tests pin that contract.
 */

const STORAGE_KEY = 'smart-erp-theme';

/**
 * Node 22 ships an experimental `localStorage` global that is disabled unless
 * the process is started with `--localstorage-file`, which shadows the
 * happy-dom Storage implementation. Install a plain in-memory Storage so the
 * provider can persist and restore the theme during tests.
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

function Consumer() {
    const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
    return (
        <div>
            <span data-testid="theme">{theme}</span>
            <span data-testid="resolved">{resolvedTheme}</span>
            <button onClick={toggleTheme}>Toggle</button>
            <button onClick={() => setTheme('light')}>Light</button>
            <button onClick={() => setTheme('system')}>System</button>
        </div>
    );
}

describe('ThemeProvider', () => {
    beforeEach(() => {
        installMemoryStorage();
        document.documentElement.classList.remove('dark');
    });

    afterEach(() => {
        cleanup();
        document.documentElement.classList.remove('dark');
    });

    it('defaults to the system preference', () => {
        render(
            <ThemeProvider>
                <Consumer />
            </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('system');
        expect(['light', 'dark']).toContain(screen.getByTestId('resolved').textContent);
    });

    it('toggles the dark class on the document root and persists the choice', () => {
        render(
            <ThemeProvider>
                <Consumer />
            </ThemeProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');
        expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));

        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
        expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    });

    it('restores a stored preference on mount', () => {
        window.localStorage.setItem(STORAGE_KEY, 'dark');

        render(
            <ThemeProvider>
                <Consumer />
            </ThemeProvider>
        );

        expect(screen.getByTestId('theme')).toHaveTextContent('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('clears the dark class when the user switches back to light', () => {
        window.localStorage.setItem(STORAGE_KEY, 'dark');

        render(
            <ThemeProvider>
                <Consumer />
            </ThemeProvider>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Light' }));

        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('throws a helpful error when used outside of the provider', () => {
        const spy = console.error;
        console.error = () => undefined;
        try {
            expect(() => render(<Consumer />)).toThrow(/ThemeProvider/);
        } finally {
            console.error = spy;
        }
    });
});
