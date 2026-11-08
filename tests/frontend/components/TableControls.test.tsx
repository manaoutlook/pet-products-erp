import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { ColumnHeader, TableControlsBar } from '@/components/ui/table-controls';
import { useTableControls } from '@/hooks/use-table-controls';

type Row = { id: number; name: string | null; qty: number };

const rows: Row[] = [
    { id: 1, name: 'Beta', qty: 3 },
    { id: 2, name: 'alpha', qty: 10 },
    { id: 3, name: 'Gamma', qty: 7 },
];

function Harness({ data = rows }: { data?: Row[] }) {
    const table = useTableControls(data, {
        name: (row) => row.name,
        qty: (row) => row.qty,
    });

    return (
        <>
            <TableControlsBar controls={table} noun="rows" />
            <Table>
                <TableHeader>
                    <TableRow>
                        <ColumnHeader controls={table} columnKey="name" label="Name" />
                        <ColumnHeader controls={table} columnKey="qty" label="Qty" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {table.rows.map((row) => (
                        <TableRow key={row.id}>
                            <TableCell>{row.name ?? '-'}</TableCell>
                            <TableCell>{row.qty}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </>
    );
}

/** Names of the rendered body rows, in display order. */
function visibleNames(): string[] {
    return screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

describe('table header controls', () => {
    it('cycles a column through ascending, descending and unsorted', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        expect(visibleNames()).toEqual(['Beta', 'alpha', 'Gamma']);

        await user.click(screen.getByRole('button', { name: /^Name: not sorted/i }));
        expect(visibleNames()).toEqual(['alpha', 'Beta', 'Gamma']);

        await user.click(screen.getByRole('button', { name: /^Name: sorted ascending/i }));
        expect(visibleNames()).toEqual(['Gamma', 'Beta', 'alpha']);

        await user.click(screen.getByRole('button', { name: /^Name: sorted descending/i }));
        expect(visibleNames()).toEqual(['Beta', 'alpha', 'Gamma']);
    });

    it('sorts numeric columns numerically instead of alphabetically', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByRole('button', { name: /^Qty: not sorted/i }));

        expect(
            screen
                .getAllByRole('row')
                .slice(1)
                .map((row) => within(row).getAllByRole('cell')[1].textContent)
        ).toEqual(['3', '7', '10']);
    });

    it('filters a single column without touching the other columns', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.type(screen.getByLabelText('Filter by Name'), 'ga');

        expect(visibleNames()).toEqual(['Gamma']);
        expect(screen.getByText('Showing 1 of 3 rows')).toBeInTheDocument();
    });

    it('clears one column filter with its own x button', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.type(screen.getByLabelText('Filter by Qty'), '1');
        expect(visibleNames()).toEqual(['alpha']);

        await user.click(screen.getByRole('button', { name: 'Clear Qty filter' }));

        expect((screen.getByLabelText('Filter by Qty') as HTMLInputElement).value).toBe('');
        expect(visibleNames()).toEqual(['Beta', 'alpha', 'Gamma']);
    });

    it('clears every filter and the sort from the status bar', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.type(screen.getByLabelText('Filter by Name'), 'a');
        await user.click(screen.getByRole('button', { name: /^Qty: not sorted/i }));

        await user.click(screen.getByRole('button', { name: 'Clear filters and sort' }));

        expect(visibleNames()).toEqual(['Beta', 'alpha', 'Gamma']);
        expect((screen.getByLabelText('Filter by Name') as HTMLInputElement).value).toBe('');
        expect(screen.getByText('3 rows')).toBeInTheDocument();
    });

    it('keeps empty cells at the bottom in both directions', async () => {
        const user = userEvent.setup();
        const data: Row[] = [
            { id: 1, name: null, qty: 1 },
            { id: 2, name: 'Zeta', qty: 2 },
            { id: 3, name: 'Anise', qty: 3 },
        ];
        render(<Harness data={data} />);

        await user.click(screen.getByRole('button', { name: /^Name: not sorted/i }));
        expect(visibleNames()).toEqual(['Anise', 'Zeta', '-']);

        await user.click(screen.getByRole('button', { name: /^Name: sorted ascending/i }));
        expect(visibleNames()).toEqual(['Zeta', 'Anise', '-']);
    });
});
