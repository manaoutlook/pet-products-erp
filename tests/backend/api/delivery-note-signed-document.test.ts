import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { deliveryNotes, salesOrderItems, salesOrders } from '../../../db/schema';
import { SalesOrderError, attachSignedDocument, issueDeliveryNote } from '../../../server/sales-orders';
import {
    DeliveryNoteDocumentError,
    MAX_SIGNED_DOCUMENT_BYTES,
    SIGNED_DOCUMENT_URL_PREFIX,
    isSignedDocumentUrl,
    saveSignedDeliveryNoteDocument,
    signedDocumentsDir,
} from '../../../server/delivery-note-documents';
import { generateSalesOrderNumber } from '../../../server/numbering';
import {
    cleanDatabase,
    resetSequences,
    seedTestData,
    resetTestDatabase,
} from '../../helpers/test-db';

/**
 * The signed delivery note (proof of delivery).
 *
 * A note is issued unsigned; the customer signs the printed sheet and the office files a photo
 * of it. Filing that photo is what flips the note to "Signed/Completed" (and ticks the "goods
 * received in good condition" box on a reprint), so both halves are pinned here: the storage
 * boundary (formats, size ceiling, where the bytes land) and the database write.
 */

// 1x1 transparent PNG - the smallest thing that is genuinely a PNG.
const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const writtenFiles: string[] = [];

/** Track the files a test created so uploads/delivery-notes stays clean. */
async function saveAndTrack(dataUrl: string) {
    const url = await saveSignedDeliveryNoteDocument(dataUrl);
    writtenFiles.push(path.join(signedDocumentsDir, path.basename(url)));
    return url;
}

describe('signed delivery note storage', () => {
    afterEach(async () => {
        await Promise.all(writtenFiles.splice(0).map((file) => fs.rm(file, { force: true })));
    });

    it('writes the picture to its own directory and returns a public URL', async () => {
        const url = await saveAndTrack(PNG_DATA_URL);

        expect(url.startsWith(SIGNED_DOCUMENT_URL_PREFIX)).toBe(true);
        expect(url.endsWith('.png')).toBe(true);
        expect(isSignedDocumentUrl(url)).toBe(true);

        const stat = await fs.stat(path.join(signedDocumentsDir, path.basename(url)));
        expect(stat.size).toBeGreaterThan(0);
    });

    it('gives two uploads of the same sheet different names', async () => {
        const first = await saveAndTrack(PNG_DATA_URL);
        const second = await saveAndTrack(PNG_DATA_URL);

        expect(first).not.toBe(second);
    });

    it('rejects a payload that is not an image', async () => {
        await expect(saveSignedDeliveryNoteDocument('not-a-picture')).rejects.toBeInstanceOf(
            DeliveryNoteDocumentError
        );
        await expect(saveSignedDeliveryNoteDocument('not-a-picture')).rejects.toThrow(
            /Invalid picture data/
        );
    });

    it('rejects a format the route does not store', async () => {
        await expect(
            saveSignedDeliveryNoteDocument('data:image/bmp;base64,AAAA')
        ).rejects.toThrow(/Unsupported picture format/);
    });

    it('rejects a picture above the size ceiling', async () => {
        const oversized = `data:image/png;base64,${Buffer.alloc(
            MAX_SIGNED_DOCUMENT_BYTES + 1,
            1
        ).toString('base64')}`;

        await expect(saveSignedDeliveryNoteDocument(oversized)).rejects.toThrow(/too large/);
    });
});

describe('filing the signed document against a delivery note', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
        await resetTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();
    });

    afterEach(async () => {
        await cleanDatabase();
        await Promise.all(writtenFiles.splice(0).map((file) => fs.rm(file, { force: true })));
    });

    /** An order with one line, shipped in full so a note exists to sign. */
    async function seedDeliveredNote() {
        const [order] = await db
            .insert(salesOrders)
            .values({
                orderNumber: generateSalesOrderNumber(),
                customerName: 'Nguyen Van A',
                companyName: 'Pet Shop A',
                contactPerson: 'Mr A',
                phone: '0900000000',
                deliveryAddress: '12 Le Loi, District 1',
                orderDate: new Date(),
                totalAmount: '400.00',
                status: 'open',
                preparedByUserId: testData.users.admin.id,
            })
            .returning();

        await db.insert(salesOrderItems).values({
            salesOrderId: order.id,
            productId: testData.products.product.id,
            productCode: testData.products.product.sku,
            description: testData.products.product.name,
            quantity: 4,
            unitPrice: '100.00',
            totalPrice: '400.00',
            deliveredQuantity: 0,
        });

        const result = await issueDeliveryNote(db, {
            salesOrderId: order.id,
            deliveryDate: new Date(),
            userId: testData.users.admin.id,
        });

        return result.deliveryNote;
    }

    it('moves the note to Signed/Completed and records who filed it', async () => {
        const note = await seedDeliveredNote();
        // Issued unsigned - this is the row that shows "Awaiting signature".
        expect(note.customerConfirmed).toBe(false);
        expect(note.signedDocumentUrl).toBeNull();

        const updated = await attachSignedDocument(db, {
            deliveryNoteId: note.id,
            signedDocumentUrl: '/uploads/delivery-notes/proof.png',
            userId: testData.users.admin.id,
        });

        expect(updated.signedDocumentUrl).toBe('/uploads/delivery-notes/proof.png');
        expect(updated.signedDocumentUploadedAt).toBeInstanceOf(Date);
        expect(updated.signedDocumentUploadedByUserId).toBe(testData.users.admin.id);
        // The uploaded picture *is* the signature, so the reprint box is ticked.
        expect(updated.customerConfirmed).toBe(true);

        const [stored] = await db.select().from(deliveryNotes).where(eq(deliveryNotes.id, note.id));
        expect(stored.signedDocumentUrl).toBe('/uploads/delivery-notes/proof.png');
        expect(stored.customerConfirmed).toBe(true);
    });

    it('replaces a blurry first picture instead of refusing a second upload', async () => {
        const note = await seedDeliveredNote();

        await attachSignedDocument(db, {
            deliveryNoteId: note.id,
            signedDocumentUrl: '/uploads/delivery-notes/blurry.png',
            userId: testData.users.admin.id,
        });

        const replaced = await attachSignedDocument(db, {
            deliveryNoteId: note.id,
            signedDocumentUrl: '/uploads/delivery-notes/sharp.png',
            userId: testData.users.admin.id,
        });

        expect(replaced.signedDocumentUrl).toBe('/uploads/delivery-notes/sharp.png');
        expect(replaced.customerConfirmed).toBe(true);
    });

    it('refuses a note that does not exist', async () => {
        await expect(
            attachSignedDocument(db, {
                deliveryNoteId: 999_999,
                signedDocumentUrl: '/uploads/delivery-notes/proof.png',
                userId: testData.users.admin.id,
            })
        ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a cancelled note', async () => {
        const note = await seedDeliveredNote();
        await db
            .update(deliveryNotes)
            .set({ status: 'cancelled' })
            .where(eq(deliveryNotes.id, note.id));

        await expect(
            attachSignedDocument(db, {
                deliveryNoteId: note.id,
                signedDocumentUrl: '/uploads/delivery-notes/proof.png',
                userId: testData.users.admin.id,
            })
        ).rejects.toBeInstanceOf(SalesOrderError);

        const [stored] = await db.select().from(deliveryNotes).where(eq(deliveryNotes.id, note.id));
        expect(stored.signedDocumentUrl).toBeNull();
        expect(stored.customerConfirmed).toBe(false);
    });
});
