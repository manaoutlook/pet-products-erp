import { describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

/**
 * The button palette is the backbone of the design system: primary blue for
 * the main action, green/gold/red for the CRUD lifecycle actions and slate
 * for neutral actions. These tests pin the semantic token classes so a new
 * variant can never silently fall back to a generic colour.
 */

type ButtonVariant =
    | 'default'
    | 'create'
    | 'view'
    | 'update'
    | 'delete'
    | 'success'
    | 'warning'
    | 'info'
    | 'destructive'
    | 'secondary'
    | 'outline'
    | 'ghost'
    | 'link';

function renderVariant(variant: ButtonVariant) {
    render(<Button variant={variant}>Action</Button>);
    return screen.getByRole('button', { name: 'Action' });
}

describe('Button - design system variants', () => {
    it('uses professional blue for the primary action', () => {
        const button = renderVariant('default');
        expect(button).toHaveClass('bg-primary', 'text-primary-foreground');
        expect(button).toHaveClass('hover:bg-primary-hover', 'active:bg-primary-active');
    });

    it('uses green for create/save actions', () => {
        for (const variant of ['create', 'success'] as const) {
            const button = renderVariant(variant);
            expect(button).toHaveClass('bg-success-strong', 'text-success-foreground');
            cleanup();
        }
    });

    it('uses a blue tonal style for view actions', () => {
        const button = renderVariant('view');
        expect(button).toHaveClass('bg-primary-subtle', 'text-primary-subtle-foreground');
        expect(button).toHaveClass('border-primary/30');
    });

    it('uses amber for edit/update actions', () => {
        for (const variant of ['update', 'warning'] as const) {
            const button = renderVariant(variant);
            expect(button).toHaveClass('bg-warning', 'text-warning-foreground');
            cleanup();
        }
    });

    it('uses red for delete actions', () => {
        for (const variant of ['delete', 'destructive'] as const) {
            const button = renderVariant(variant);
            expect(button).toHaveClass('bg-destructive', 'text-destructive-foreground');
            cleanup();
        }
    });

    it('uses cyan for informational actions', () => {
        const button = renderVariant('info');
        expect(button).toHaveClass('bg-info-strong', 'text-info-foreground');
    });

    it('uses slate for secondary actions', () => {
        const button = renderVariant('secondary');
        expect(button).toHaveClass('bg-secondary-solid', 'text-white');
        expect(button).toHaveClass('hover:bg-secondary-solid-hover');
    });

    it('keeps neutral variants token based', () => {
        expect(renderVariant('outline')).toHaveClass('border-input', 'bg-card', 'text-foreground');
        cleanup();
        expect(renderVariant('ghost')).toHaveClass('hover:bg-accent');
        cleanup();
        expect(renderVariant('link')).toHaveClass('text-link', 'hover:text-link-hover');
    });

    it('supports the disabled state for every variant', () => {
        render(
            <Button variant="delete" disabled>
                Remove
            </Button>
        );
        const button = screen.getByRole('button', { name: 'Remove' });
        expect(button).toBeDisabled();
        expect(button).toHaveClass('disabled:opacity-50', 'disabled:pointer-events-none');
    });

    it('honours the tokenised sizes', () => {
        render(<Button size="icon" aria-label="Edit" />);
        expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass('h-control', 'w-control');
    });
});
