import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    Toast,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
} from '@/components/ui/toast';

function renderToast(variant?: 'default' | 'destructive' | 'success') {
    return render(
        <ToastProvider>
            <Toast variant={variant} open>
                <div>
                    <ToastTitle>Success</ToastTitle>
                    <ToastDescription>Product &quot;Leash&quot; updated successfully</ToastDescription>
                </div>
            </Toast>
            <ToastViewport />
        </ToastProvider>
    );
}

describe('Toast - destructive variant', () => {
    it('renders a red background with white text', () => {
        renderToast('destructive');

        const toast = screen.getByText('Success').closest('li');

        expect(toast).not.toBeNull();
        expect(toast).toHaveClass('bg-red-600');
        expect(toast).toHaveClass('text-white');
        // The `destructive` class drives the group-* overrides (e.g. the close button).
        expect(toast).toHaveClass('destructive');
        expect(toast).not.toHaveClass('bg-green-600');
    });

    it('renders the destructive title and description in bold white text', () => {
        renderToast('destructive');

        expect(screen.getByText('Success')).toHaveClass('group-[.destructive]:font-bold');
        expect(
            screen.getByText('Product "Leash" updated successfully')
        ).toHaveClass('group-[.destructive]:font-bold', 'group-[.destructive]:opacity-100');
    });
});
describe('Toast - success variant', () => {

    it('renders a green background with white text', () => {
        renderToast('success');

        const toast = screen.getByText('Success').closest('li');

        expect(toast).not.toBeNull();
        expect(toast).toHaveClass('bg-green-600');
        expect(toast).toHaveClass('text-white');
        // The `success` class drives the group-* overrides (e.g. the close button).
        expect(toast).toHaveClass('success');
        expect(toast).not.toHaveClass('bg-destructive');
    });

    it('renders the success title and description in bold white text', () => {
        renderToast('success');

        // The group-[.success] variant on the title/description is what makes the
        // text bold (and fully opaque) so it stays readable on the green background.
        expect(screen.getByText('Success')).toHaveClass('group-[.success]:font-bold');
        expect(
            screen.getByText('Product "Leash" updated successfully')
        ).toHaveClass('group-[.success]:font-bold', 'group-[.success]:opacity-100');
    });

    it('keeps the neutral styling for the default variant', () => {
        renderToast();

        const toast = screen.getByText('Success').closest('li');

        expect(toast).toHaveClass('bg-background');
        expect(toast).not.toHaveClass('bg-green-600');
    });
});
