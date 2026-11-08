import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

/**
 * Shared primitives must all draw from the semantic token palette so the
 * status colours, form fields and data grids look identical on every screen.
 */

describe('Badge - status variants', () => {
    it.each([
        ['success', 'bg-success-subtle', 'text-success-subtle-foreground'],
        ['warning', 'bg-warning-subtle', 'text-warning-subtle-foreground'],
        ['info', 'bg-info-subtle', 'text-info-subtle-foreground'],
        ['destructive', 'bg-destructive-subtle', 'text-destructive-subtle-foreground'],
    ] as const)('renders the %s chip with tinted background and strong text', (variant, bg, text) => {
        render(<Badge variant={variant}>Status</Badge>);
        expect(screen.getByText('Status')).toHaveClass(bg, text);
    });

    it('renders the default chip in primary blue', () => {
        render(<Badge>New</Badge>);
        expect(screen.getByText('New')).toHaveClass('bg-primary', 'text-primary-foreground');
    });
});

describe('Alert - status variants', () => {
    it.each([
        ['success', 'bg-success-subtle'],
        ['warning', 'bg-warning-subtle'],
        ['info', 'bg-info-subtle'],
        ['destructive', 'bg-destructive-subtle'],
    ] as const)('renders the %s alert on a tinted surface', (variant, bg) => {
        render(
            <Alert variant={variant}>
                <AlertTitle>Heads up</AlertTitle>
                <AlertDescription>Something happened</AlertDescription>
            </Alert>
        );
        expect(screen.getByRole('alert')).toHaveClass(bg);
    });
});

describe('Form controls', () => {
    it('renders inputs from the surface + border + focus tokens', () => {
        render(<Input placeholder="Search" />);
        const input = screen.getByPlaceholderText('Search');
        expect(input).toHaveClass('border-input', 'bg-card');
        expect(input).toHaveClass('focus-visible:border-primary');
        expect(input).toHaveClass('disabled:bg-muted');
    });

    it('renders textareas with the same field chrome', () => {
        render(<Textarea placeholder="Notes" />);
        expect(screen.getByPlaceholderText('Notes')).toHaveClass('border-input', 'bg-card');
    });

    it('renders labels with the unified label typography', () => {
        render(<Label htmlFor="sku">SKU</Label>);
        expect(screen.getByText('SKU')).toHaveClass('text-sm', 'font-medium');
    });
});

describe('Data table', () => {
    it('uses the table header token for the header row and borders for rows', () => {
        render(
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Product</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow data-state="selected">
                        <TableCell>Leash</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        );

        expect(screen.getByText('Product').closest('thead')).toHaveClass('bg-table-header');
        expect(screen.getByText('Product')).toHaveClass('text-table-header-foreground');
        expect(screen.getByText('Leash').closest('tr')).toHaveClass(
            'hover:bg-table-row-hover',
            'data-[state=selected]:bg-table-row-selected'
        );
    });
});
