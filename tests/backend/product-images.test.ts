import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    MAX_GALLERY_IMAGES,
    MAX_IMAGE_BYTES,
    PRODUCT_IMAGE_URL_PREFIX,
    ProductImageError,
    isProductImageUrl,
    productImagesDir,
    saveProductImage,
} from '../../server/product-images';

/**
 * Product pictures are stored as files and referenced by a short URL, so this
 * module is the boundary that decides what a product row may point at. These
 * tests pin down the accepted formats, the size ceiling and the fact that the
 * bytes really land in uploads/products/.
 */

// 1x1 transparent PNG - the smallest thing that is genuinely a PNG.
const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const writtenFiles: string[] = [];

/** Track the files a test created so the uploads directory stays clean. */
async function saveAndTrack(dataUrl: string) {
    const url = await saveProductImage(dataUrl);
    writtenFiles.push(path.join(productImagesDir, path.basename(url)));
    return url;
}

describe('product image storage', () => {
    afterEach(async () => {
        await Promise.all(
            writtenFiles.splice(0).map((file) => fs.rm(file, { force: true }))
        );
    });

    it('writes the picture to disk and returns a public URL', async () => {
        const url = await saveAndTrack(PNG_DATA_URL);

        expect(url.startsWith(PRODUCT_IMAGE_URL_PREFIX)).toBe(true);
        expect(url.endsWith('.png')).toBe(true);
        expect(isProductImageUrl(url)).toBe(true);

        const file = path.join(productImagesDir, path.basename(url));
        const stat = await fs.stat(file);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('gives two uploads of the same picture different names', async () => {
        const first = await saveAndTrack(PNG_DATA_URL);
        const second = await saveAndTrack(PNG_DATA_URL);

        expect(first).not.toBe(second);
    });

    it('accepts the formats the browser compression can produce', async () => {
        const jpeg = await saveAndTrack(
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA=='
        );
        const webp = await saveAndTrack('data:image/webp;base64,UklGRgAAAABXRUJQ');

        expect(jpeg.endsWith('.jpg')).toBe(true);
        expect(webp.endsWith('.webp')).toBe(true);
    });

    it('rejects values that are not base64 image data URLs', async () => {
        await expect(saveProductImage('https://example.com/cat.png')).rejects.toBeInstanceOf(
            ProductImageError
        );
        await expect(saveProductImage('not-an-image')).rejects.toBeInstanceOf(ProductImageError);
    });

    it('rejects unsupported image formats such as SVG', async () => {
        await expect(
            saveProductImage('data:image/svg+xml;base64,PHN2Zy8+')
        ).rejects.toThrow(/Unsupported image format/);
    });

    it('rejects an empty payload', async () => {
        await expect(saveProductImage('data:image/png;base64,')).rejects.toBeInstanceOf(
            ProductImageError
        );
    });

    it('caps the decoded picture at 5 MB', async () => {
        expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);

        const oversized = `data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString(
            'base64'
        )}`;

        await expect(saveProductImage(oversized)).rejects.toThrow(/too large/i);
    });

    it('stores ten extra pictures per product alongside the featured one', () => {
        expect(MAX_GALLERY_IMAGES).toBe(10);
    });

    it('only accepts upload URLs or http(s) hosts as product picture URLs', () => {
        expect(isProductImageUrl('/uploads/products/123.png')).toBe(true);
        expect(isProductImageUrl('https://cdn.example.com/cat.png')).toBe(true);
        expect(isProductImageUrl('http://cdn.example.com/cat.png')).toBe(true);
        expect(isProductImageUrl('javascript:alert(1)')).toBe(false);
        expect(isProductImageUrl('/etc/passwd')).toBe(false);
        expect(isProductImageUrl('data:image/png;base64,AAAA')).toBe(false);
    });
});
