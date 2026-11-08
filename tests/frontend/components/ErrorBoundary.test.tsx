import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Boom({ explode }: { explode: boolean }) {
    if (explode) {
        throw new Error('product list exploded');
    }
    return <p>dashboard is fine</p>;
}

describe('ErrorBoundary', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // React re-logs caught render errors; keep the test output readable.
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    it('renders its children when nothing throws', () => {
        render(
            <ErrorBoundary section="This screen">
                <Boom explode={false} />
            </ErrorBoundary>
        );

        expect(screen.getByText('dashboard is fine')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('replaces the crashing tree with a recovery screen instead of a blank page', () => {
        render(
            <ErrorBoundary section="This screen">
                <Boom explode />
            </ErrorBoundary>
        );

        const fallback = screen.getByRole('alert');
        expect(fallback).toHaveTextContent('This screen could not be displayed');
        // The message is shown so the user can quote it to support.
        expect(fallback).toHaveTextContent('product list exploded');
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    });

    it('logs the error and the component stack to the console', () => {
        render(
            <ErrorBoundary section="This screen">
                <Boom explode />
            </ErrorBoundary>
        );

        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('This screen crashed'),
            expect.any(Error),
            expect.anything()
        );
    });

    it('recovers in place when the retry button is pressed after the fault is gone', () => {
        let shouldThrow = true;

        function Flaky() {
            if (shouldThrow) {
                throw new Error('transient render failure');
            }

            return <p>recovered content</p>;
        }

        render(
            <ErrorBoundary section="This screen">
                <Flaky />
            </ErrorBoundary>
        );

        // The crash cause is gone (e.g. the malformed row was corrected elsewhere);
        // retrying re-renders the real screen instead of a blank page.
        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));

        expect(screen.getByText('recovered content')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('uses a generic heading when no section name is given', () => {
        render(
            <ErrorBoundary>
                <Boom explode />
            </ErrorBoundary>
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });
});
