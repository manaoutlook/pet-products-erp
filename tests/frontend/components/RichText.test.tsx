import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from '@/components/RichText';
import { isHtml, toPlainText } from '@/utils/rich-text';

describe('rich-text helpers', () => {
    describe('isHtml', () => {
        it('detects common HTML fragments', () => {
            expect(isHtml('<p class="p1">Hello</p>')).toBe(true);
            expect(isHtml('Line one<br>Line two')).toBe(true);
            expect(isHtml('<span class="s1">x</span>')).toBe(true);
        });

        it('treats plain text (even with a bare "<") as text', () => {
            expect(isHtml('65W GaN charger')).toBe(false);
            expect(isHtml('Fits screens < 15 inch')).toBe(false);
            expect(isHtml('')).toBe(false);
            expect(isHtml(null)).toBe(false);
            expect(isHtml(undefined)).toBe(false);
        });
    });

    describe('toPlainText', () => {
        it('returns plain text unchanged (trimmed)', () => {
            expect(toPlainText('  Steel bottle  ')).toBe('Steel bottle');
        });

        it('strips tags and keeps the readable content', () => {
            expect(toPlainText('<p class="p1">Strong <strong>body</strong></p>')).toBe(
                'Strong body'
            );
        });

        it('drops script/style blocks entirely', () => {
            expect(
                toPlainText('<style>.s1{color:red}</style><p>Visible</p><script>alert(1)</script>')
            ).toBe('Visible');
        });

        it('decodes common HTML entities', () => {
            expect(toPlainText('Motorbike &amp; Bicycle&nbsp;Holder &lt;2kg&gt;')).toBe(
                'Motorbike & Bicycle Holder <2kg>'
            );
        });

        it('handles null/empty values', () => {
            expect(toPlainText(null)).toBe('');
            expect(toPlainText('')).toBe('');
        });
    });
});

describe('RichText', () => {
    it('renders plain text and preserves line breaks without parsing markup', () => {
        const { container } = render(<RichText value={'Line one\nLine two < 3'} />);
        expect(screen.getByText(/Line one/)).toBeTruthy();
        expect(container.querySelector('.whitespace-pre-line')).toBeTruthy();
        expect(container.querySelector('p, strong, span')).toBeNull();
    });

    it('renders sanitised HTML with its formatting intact', () => {
        const { container } = render(
            <RichText value={'<p>Strong <strong>450 g</strong> body</p><ul><li>Light</li></ul>'} />
        );
        expect(container.querySelector('strong')?.textContent).toBe('450 g');
        expect(container.querySelector('li')?.textContent).toBe('Light');
        expect(container.querySelector('.rich-text')).toBeTruthy();
    });

    it('strips scripts and event handlers from HTML', () => {
        const { container } = render(
            <RichText value={'<p onclick="alert(1)">Safe</p><script>alert(2)</script>'} />
        );
        expect(container.innerHTML).not.toContain('<script');
        expect(container.innerHTML).not.toContain('onclick');
        expect(screen.getByText('Safe')).toBeTruthy();
    });

    it('renders the fallback when the value is empty', () => {
        render(<RichText value={null} fallback={<span>Not set</span>} />);
        expect(screen.getByText('Not set')).toBeTruthy();
    });
});
