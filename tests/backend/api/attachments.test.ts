import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { attachments, purchaseOrders } from "../../../db/schema";
import { cleanDatabase, resetSequences, seedTestData } from "../../helpers/test-db";
import { handlerFor, invoke, recordRoutes } from "../../helpers/route-harness";
import { registerAttachmentRoutes } from "../../../server/routes/attachments";
import { attachmentsDir } from "../../../server/attachment-files";
import { MAX_ATTACHMENTS_PER_ENTITY } from "../../../shared/attachments";

/**
 * The proof-document endpoints, run against the real database.
 *
 * The point of these tests is the contract the four upload screens rely on:
 *
 *   - a picture is filed against an EXISTING transaction (no orphan rows for a wrong id);
 *   - the limit is above the five pictures the business asked for, and is enforced server-side;
 *   - access follows the transaction (purchase orders need `purchaseOrders`, money needs
 *     `receipts`, manual entries need `finance`);
 *   - removing a picture is a row + file delete.
 */

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const routes = recordRoutes(registerAttachmentRoutes);
const postAttachment = handlerFor(routes, "POST", "/api/attachments");
const getAttachments = handlerFor(routes, "GET", "/api/attachments");
const deleteAttachment = handlerFor(routes, "DELETE", "/api/attachments/:id");

const writtenFiles: string[] = [];

function track(url: string) {
  writtenFiles.push(path.join(attachmentsDir, path.basename(url)));
}

describe("attachment endpoints", () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let orderId: number;

  const admin = () => ({ id: data.users.admin.id, role: { name: "admin" } });
  const staffWithoutFinance = () => ({
    id: data.users.manager.id,
    role: { name: "cashier", hierarchyLevel: "staff", permissions: {} },
  });

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    const [order] = await db
      .insert(purchaseOrders)
      .values({
        orderNumber: "PO-ATT-001",
        supplierId: data.suppliers.supplier.id,
        deliveryDate: new Date("2030-01-01T00:00:00.000Z"),
        status: "pending",
        totalAmount: "1000.00",
      })
      .returning();

    orderId = order.id;
  });

  afterAll(async () => {
    await Promise.all(writtenFiles.splice(0).map((file) => fs.rm(file, { force: true })));
  });


  it("stores a picture against an existing purchase order and lists it", async () => {
    const created = await invoke(postAttachment, {
      user: admin(),
      body: {
        entityType: "purchase_order",
        entityId: orderId,
        fileName: "supplier-invoice.png",
        dataUrl: PNG_DATA_URL,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.body.attachment.url.startsWith("/uploads/attachments/")).toBe(true);
    track(created.body.attachment.url);

    const listed = await invoke(getAttachments, {
      user: admin(),
      query: { entityType: "purchase_order", entityId: String(orderId) },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.body.attachments).toHaveLength(1);
    expect(listed.body.attachments[0].fileName).toBe("supplier-invoice.png");
    expect(listed.body.limit).toBe(MAX_ATTACHMENTS_PER_ENTITY);
  });

  it("refuses a picture for a transaction that does not exist", async () => {
    const missing = await invoke(postAttachment, {
      user: admin(),
      body: {
        entityType: "purchase_order",
        entityId: 999999,
        fileName: "ghost.png",
        dataUrl: PNG_DATA_URL,
      },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.body.message).toMatch(/not found/i);
    expect(await db.select().from(attachments)).toHaveLength(0);
  });

  it("enforces the per-transaction limit above the five the business asked for", async () => {
    expect(MAX_ATTACHMENTS_PER_ENTITY).toBeGreaterThanOrEqual(5);

    for (let index = 0; index < MAX_ATTACHMENTS_PER_ENTITY; index += 1) {
      const created = await invoke(postAttachment, {
        user: admin(),
        body: {
          entityType: "purchase_order",
          entityId: orderId,
          fileName: `receipt-${index}.png`,
          dataUrl: PNG_DATA_URL,
        },
      });
      expect(created.statusCode).toBe(201);
      track(created.body.attachment.url);
    }

    const overTheLimit = await invoke(postAttachment, {
      user: admin(),
      body: {
        entityType: "purchase_order",
        entityId: orderId,
        fileName: "one-too-many.png",
        dataUrl: PNG_DATA_URL,
      },
    });

    expect(overTheLimit.statusCode).toBe(400);
    expect(overTheLimit.body.message).toMatch(/already has/i);
  });

  it("requires the permission module that owns the transaction", async () => {
    const deniedPost = await invoke(postAttachment, {
      user: staffWithoutFinance(),
      body: {
        entityType: "purchase_order",
        entityId: orderId,
        fileName: "invoice.png",
        dataUrl: PNG_DATA_URL,
      },
    });
    expect(deniedPost.statusCode).toBe(403);

    const deniedRead = await invoke(getAttachments, {
      user: staffWithoutFinance(),
      query: { entityType: "finance_entry", entityId: "1" },
    });
    expect(deniedRead.statusCode).toBe(403);

    const allowedRead = await invoke(getAttachments, {
      user: {
        id: data.users.manager.id,
        role: {
          name: "store_manager",
          hierarchyLevel: "staff",
          permissions: { finance: { read: true } },
        },
      },
      query: { entityType: "finance_entry", entityId: "1" },
    });
    expect(allowedRead.statusCode).toBe(200);
    expect(allowedRead.body.attachments).toEqual([]);
  });

  it("removes the row and the file, and answers 404 for an unknown picture", async () => {
    const created = await invoke(postAttachment, {
      user: admin(),
      body: {
        entityType: "purchase_order",
        entityId: orderId,
        fileName: "transfer.png",
        dataUrl: PNG_DATA_URL,
      },
    });

    const file = path.join(attachmentsDir, path.basename(created.body.attachment.url));
    await expect(fs.stat(file)).resolves.toBeTruthy();

    const removed = await invoke(deleteAttachment, {
      user: admin(),
      params: { id: String(created.body.attachment.id) },
    });
    expect(removed.statusCode).toBe(204);

    await expect(fs.stat(file)).rejects.toThrow();
    expect(
      await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, created.body.attachment.id))
    ).toHaveLength(0);

    const again = await invoke(deleteAttachment, { user: admin(), params: { id: "999999" } });
    expect(again.statusCode).toBe(404);
  });
});
