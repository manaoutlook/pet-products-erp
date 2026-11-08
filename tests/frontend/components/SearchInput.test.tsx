import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchInput } from '@/components/ui/search-input';

function ControlledSearchInput({
    initialValue = '',
    onChangeSpy,
}: {
    initialValue?: string;
    onChangeSpy?: (value: string) => void;
}) {
    const [value, setValue] = useState(initialValue);

    return (
        <SearchInput
            aria-label="Search field"
            placeholder="Search products..."
            value={value}
            onValueChange={(next) => {
                setValue(next);
                onChangeSpy?.(next);
            }}
        />
    );
}

describe('SearchInput', () => {
    it('renders the search icon and placeholder without a clear button when empty', () => {
        render(<ControlledSearchInput />);

        expect(screen.getByPlaceholderText('Search products...')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('calls onValueChange while typing and shows the clear button', async () => {
        const user = userEvent.setup();
        const onChangeSpy = vi.fn();

        render(<ControlledSearchInput onChangeSpy={onChangeSpy} />);

        await user.type(screen.getByRole('textbox', { name: 'Search field' }), 'dog');

        expect(onChangeSpy).toHaveBeenLastCalledWith('dog');
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('clears the field when the x button is clicked and keeps the focus', async () => {
        const user = userEvent.setup();
        const onChangeSpy = vi.fn();

        render(<ControlledSearchInput initialValue="MP-AD-26A001" onChangeSpy={onChangeSpy} />);

        const input = screen.getByRole('textbox', { name: 'Search field' }) as HTMLInputElement;
        expect(input.value).toBe('MP-AD-26A001');

        await user.click(screen.getByRole('button', { name: 'Clear search' }));

        expect(onChangeSpy).toHaveBeenLastCalledWith('');
        expect(input.value).toBe('');
        expect(input).toHaveFocus();
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('clears the field when Escape is pressed', async () => {
        const user = userEvent.setup();

        render(<ControlledSearchInput initialValue="Leash" />);

        const input = screen.getByRole('textbox', { name: 'Search field' }) as HTMLInputElement;

        await user.type(input, '{Escape}');

        expect(input.value).toBe('');
    });
});
