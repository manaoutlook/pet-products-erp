import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ProductImageUpload } from '@/components/products/ProductImageUpload';
import {
    MAX_PRODUCT_GALLERY_IMAGES,
    ProductImageUploadError,
} from '@/utils/product-image-upload';

const { toastMock, uploadMock } = vi.hoisted(() => ({
    toastMock: vi.fn(),
    uploadMock: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

// The upload helper is the only thing that touches the network / canvas, so it is
// replaced: these tests are about what the picker does with the returned URL.
vi.mock('@/utils/product-image-upload', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/product-image-upload')>();
    return { ...actual, uploadProductImage: uploadMock };
});

/**
 * The picker is a controlled component: the form (ProductFormDialog) owns the
 * featured URL and the gallery array. The harness below does the same so the
 * assertions can read the state that would be submitted with the product.
 */
function Harness({
    initialFeatured = null,
    initialGallery = [],
}: {
    initialFeatured?: string | null;
    initialGallery?: string[];
}) {
    const [featuredImage, setFeaturedImage] = useState<string | null>(initialFeatured);
    const [galleryImages, setGalleryImages] = useState<string[]>(initialGallery);

    return (
        <>
            <ProductImageUpload
                featuredImage={featuredImage}
                galleryImages={galleryImages}
                onFeaturedChange={setFeaturedImage}
                onGalleryChange={setGalleryImages}
            />
            <p data-testid="form-state">
                {JSON.stringify({ featuredImage, galleryImages })}
            </p>
        </>
    );
}

const formState = () => JSON.parse(screen.getByTestId('form-state').textContent ?? '{}');

const makeFile = (name = 'photo.png', type = 'image/png') =>
    new File(['binary'], name, { type });

const galleryOf = (count: number) =>
    Array.from({ length: count }, (_, index) => `/uploads/products/${index}.jpg`);

describe('ProductImageUpload', () => {
    beforeEach(() => {
        uploadMock.mockReset();
        toastMock.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('uploads a picked file and shows it as the featured picture', async () => {
        uploadMock.mockResolvedValue('/uploads/products/featured.jpg');
        render(<Harness />);

        fireEvent.change(screen.getByLabelText('Upload featured picture'), {
            target: { files: [makeFile()] },
        });

        await waitFor(() => expect(formState().featuredImage).toBe('/uploads/products/featured.jpg'));
        expect(uploadMock).toHaveBeenCalledTimes(1);
        expect(formState().galleryImages).toEqual([]);
        // A featured picture can be replaced or removed once it exists.
        expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('appends every picked gallery file and counts them', async () => {
        uploadMock
            .mockResolvedValueOnce('/uploads/products/a.jpg')
            .mockResolvedValueOnce('/uploads/products/b.jpg');

        render(<Harness initialGallery={['/uploads/products/0.jpg']} />);
        expect(screen.getByText(`1/${MAX_PRODUCT_GALLERY_IMAGES}`)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Upload additional pictures'), {
            target: { files: [makeFile('a.png'), makeFile('b.png')] },
        });

        await waitFor(() =>
            expect(formState().galleryImages).toEqual([
                '/uploads/products/0.jpg',
                '/uploads/products/a.jpg',
                '/uploads/products/b.jpg',
            ])
        );
        expect(uploadMock).toHaveBeenCalledTimes(2);
        expect(screen.getByText(`3/${MAX_PRODUCT_GALLERY_IMAGES}`)).toBeInTheDocument();
        // Featured stays untouched - gallery uploads never overwrite it.
        expect(formState().featuredImage).toBeNull();
    });

    it('never uploads more files than there are free gallery slots', async () => {
        uploadMock.mockResolvedValue('/uploads/products/new.jpg');

        // One free slot left, three files picked.
        render(<Harness initialGallery={galleryOf(MAX_PRODUCT_GALLERY_IMAGES - 1)} />);

        fireEvent.change(screen.getByLabelText('Upload additional pictures'), {
            target: { files: [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')] },
        });

        await waitFor(() =>
            expect(formState().galleryImages).toHaveLength(MAX_PRODUCT_GALLERY_IMAGES)
        );
        expect(uploadMock).toHaveBeenCalledTimes(1);
    });

    it('disables the add button when the gallery is full', () => {
        render(<Harness initialGallery={galleryOf(MAX_PRODUCT_GALLERY_IMAGES)} />);

        expect(
            screen.getByText(
                `${MAX_PRODUCT_GALLERY_IMAGES}/${MAX_PRODUCT_GALLERY_IMAGES}`
            )
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
    });

    it('promotes a gallery picture to featured and keeps the old featured one', async () => {
        const user = userEvent.setup();
        render(
            <Harness
                initialFeatured="/uploads/products/featured.jpg"
                initialGallery={['/uploads/products/1.jpg', '/uploads/products/2.jpg']}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Use picture 1 as featured' }));

        expect(formState().featuredImage).toBe('/uploads/products/1.jpg');
        // The previous featured picture is not lost - it takes the promoted slot.
        expect(formState().galleryImages).toEqual([
            '/uploads/products/featured.jpg',
            '/uploads/products/2.jpg',
        ]);
    });

    it('removes a gallery picture without touching the others', async () => {
        const user = userEvent.setup();
        render(<Harness initialGallery={['/uploads/products/1.jpg', '/uploads/products/2.jpg']} />);

        await user.click(screen.getByRole('button', { name: 'Remove picture 1' }));

        expect(formState().galleryImages).toEqual(['/uploads/products/2.jpg']);
    });

    it('clears the featured picture', async () => {
        const user = userEvent.setup();
        render(<Harness initialFeatured="/uploads/products/featured.jpg" />);

        await user.click(screen.getByRole('button', { name: /remove/i }));

        expect(formState().featuredImage).toBeNull();
        expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    });

    it('shows the server message in a destructive toast and keeps the state', async () => {
        uploadMock.mockRejectedValue(new ProductImageUploadError('The image is too large.'));
        render(<Harness />);

        fireEvent.change(screen.getByLabelText('Upload featured picture'), {
            target: { files: [makeFile()] },
        });

        await waitFor(() =>
            expect(toastMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    description: 'The image is too large.',
                    variant: 'destructive',
                })
            )
        );
        expect(formState().featuredImage).toBeNull();
    });
});
