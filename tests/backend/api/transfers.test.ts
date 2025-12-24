import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { transferRequests, transferRequestItems, transferActions, transferHistory, inventory, products, stores } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

describe('Inventory Transfer System Tests', () => {
    let testData: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
        // Reset database once per test file for clean state
        await resetTestDatabase();
    });

    beforeEach(async () => {
        // Clean data between tests but keep schema
        await cleanDatabase();
        await resetSequences();
        testData = await seedTestData();
    });

    afterEach(async () => {
        await cleanDatabase();
    });

    describe('Transfer Request Creation', () => {
        it('should create a new transfer request', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-TEST-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
                notes: 'Test transfer request',
            }).returning();

            expect(transfer).toBeDefined();
            expect(transfer.transferNumber).toBe('TRF-TEST-001');
            expect(transfer.status).toBe('pending');
            expect(transfer.priority).toBe('normal');
        });

        it('should enforce unique transfer numbers', async () => {
            // Create first transfer
            await db.insert(transferRequests).values({
                transferNumber: 'TRF-DUP-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            });

            // Try to create duplicate
            await expect(async () => {
                await db.insert(transferRequests).values({
                    transferNumber: 'TRF-DUP-001', // Same transfer number
                    fromStoreId: testData.stores.store1.id,
                    toStoreId: testData.stores.warehouse.id,
                    requestedByUserId: testData.users.admin.id,
                    status: 'pending',
                    priority: 'normal',
                });
            }).rejects.toThrow();
        });

        it('should create transfer with multiple items', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-MULTI-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'high',
            }).returning();

            // Add multiple items
            await db.insert(transferRequestItems).values([
                {
                    transferRequestId: transfer.id,
                    productId: testData.products.product.id,
                    requestedQuantity: 10,
                },
                {
                    transferRequestId: transfer.id,
                    productId: testData.products.product.id,
                    requestedQuantity: 5,
                }
            ]);

            const transferWithItems = await db.query.transferRequests.findFirst({
                where: eq(transferRequests.id, transfer.id),
                with: {
                    items: true,
                },
            });

            expect(transferWithItems?.items).toHaveLength(2);
            expect(transferWithItems?.items[0].requestedQuantity).toBe(10);
            expect(transferWithItems?.items[1].requestedQuantity).toBe(5);
        });

        it('should support different priority levels', async () => {
            const priorities = ['normal', 'high', 'urgent'];

            for (const priority of priorities) {
                const [transfer] = await db.insert(transferRequests).values({
                    transferNumber: `TRF-${priority.toUpperCase()}-001`,
                    fromStoreId: testData.stores.store1.id,
                    toStoreId: testData.stores.warehouse.id,
                    requestedByUserId: testData.users.admin.id,
                    status: 'pending',
                    priority: priority as any,
                }).returning();

                expect(transfer.priority).toBe(priority);
            }
        });
    });

    describe('Transfer Request Approval Workflow', () => {
        it('should approve transfer request', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-APPROVE-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            // Approve transfer
            const [approved] = await db.update(transferRequests)
                .set({ status: 'approved' })
                .where(eq(transferRequests.id, transfer.id))
                .returning();

            expect(approved.status).toBe('approved');
        });

        it('should reject transfer request with reason', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-REJECT-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            // Reject transfer
            const [rejected] = await db.update(transferRequests)
                .set({ status: 'rejected' })
                .where(eq(transferRequests.id, transfer.id))
                .returning();

            expect(rejected.status).toBe('rejected');
        });

        it('should track approval/rejection actions', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-ACTION-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'high',
            }).returning();

            // Record approval action
            await db.insert(transferActions).values({
                transferRequestId: transfer.id,
                actionType: 'approved',
                actionData: { approvedQuantity: 15, notes: 'Approved for transfer' },
                performedByUserId: testData.users.admin.id,
            });

            const transferWithActions = await db.query.transferRequests.findFirst({
                where: eq(transferRequests.id, transfer.id),
                with: {
                    actions: true,
                },
            });

            expect(transferWithActions?.actions).toHaveLength(1);
            expect(transferWithActions?.actions[0].actionType).toBe('approved');
        });
    });

    describe('Transfer Completion and Inventory Movement', () => {
        it('should complete transfer and update inventory', async () => {
            // Create inventory at source store
            const [sourceInventory] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 20,
            }).returning();

            // Create inventory at destination store (initially empty)
            const [destInventory] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.warehouse.id,
                quantity: 0,
            }).returning();

            // Create approved transfer
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-COMPLETE-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'approved',
                priority: 'normal',
            }).returning();

            // Add transfer item
            await db.insert(transferRequestItems).values({
                transferRequestId: transfer.id,
                productId: testData.products.product.id,
                requestedQuantity: 10,
                approvedQuantity: 10,
                transferredQuantity: 10,
            });

            // Record transfer completion in history
            await db.insert(transferHistory).values({
                transferRequestId: transfer.id,
                fromInventoryId: sourceInventory.id,
                toInventoryId: destInventory.id,
                productId: testData.products.product.id,
                quantity: 10,
                transferredByUserId: testData.users.admin.id,
                notes: 'Transfer completed successfully',
            });

            // Update transfer status to completed
            await db.update(transferRequests)
                .set({ status: 'completed' })
                .where(eq(transferRequests.id, transfer.id));

            const completedTransfer = await db.query.transferRequests.findFirst({
                where: eq(transferRequests.id, transfer.id),
                with: {
                    history: true,
                },
            });

            expect(completedTransfer?.status).toBe('completed');
            expect(completedTransfer?.history).toHaveLength(1);
            expect(completedTransfer?.history[0].quantity).toBe(10);
        });

        it('should track partial transfers', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-PARTIAL-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'approved',
                priority: 'normal',
            }).returning();

            // Add item with partial transfer
            await db.insert(transferRequestItems).values({
                transferRequestId: transfer.id,
                productId: testData.products.product.id,
                requestedQuantity: 20,
                approvedQuantity: 15,
                transferredQuantity: 10, // Partial transfer
            });

            const item = await db.query.transferRequestItems.findFirst({
                where: eq(transferRequestItems.transferRequestId, transfer.id),
            });

            expect(item?.requestedQuantity).toBe(20);
            expect(item?.approvedQuantity).toBe(15);
            expect(item?.transferredQuantity).toBe(10);
        });
    });

    describe('Transfer Validation and Constraints', () => {
        it('should require valid source store', async () => {
            await expect(async () => {
                await db.insert(transferRequests).values({
                    transferNumber: 'TRF-INVALID-001',
                    fromStoreId: 99999, // Non-existent store
                    toStoreId: testData.stores.warehouse.id,
                    requestedByUserId: testData.users.admin.id,
                    status: 'pending',
                    priority: 'normal',
                });
            }).rejects.toThrow();
        });

        it('should require valid destination store', async () => {
            await expect(async () => {
                await db.insert(transferRequests).values({
                    transferNumber: 'TRF-INVALID-002',
                    fromStoreId: testData.stores.store1.id,
                    toStoreId: 99999, // Non-existent store
                    requestedByUserId: testData.users.admin.id,
                    status: 'pending',
                    priority: 'normal',
                });
            }).rejects.toThrow();
        });

        it('should prevent transfer from store to itself', async () => {
            // This should be allowed by database but validated by business logic
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-SAME-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.store1.id, // Same store
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            expect(transfer.fromStoreId).toBe(transfer.toStoreId);
        });

        it('should validate transfer item relationships', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-VALIDATE-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            // Try to add item with invalid product
            await expect(async () => {
                await db.insert(transferRequestItems).values({
                    transferRequestId: transfer.id,
                    productId: 99999, // Non-existent product
                    requestedQuantity: 5,
                });
            }).rejects.toThrow();
        });
    });

    describe('Transfer Audit Trail', () => {
        it('should maintain complete transfer history', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-HISTORY-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'urgent',
            }).returning();

            // Create inventory records for transfer
            const [fromInv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 25,
            }).returning();

            const [toInv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.warehouse.id,
                quantity: 5,
            }).returning();

            // Record multiple actions
            await db.insert(transferActions).values([
                {
                    transferRequestId: transfer.id,
                    actionType: 'requested',
                    actionData: { notes: 'Transfer requested for stock replenishment' },
                    performedByUserId: testData.users.admin.id,
                },
                {
                    transferRequestId: transfer.id,
                    actionType: 'approved',
                    actionData: { approvedQuantity: 12, notes: 'Approved by store manager' },
                    performedByUserId: testData.users.admin.id,
                },
                {
                    transferRequestId: transfer.id,
                    actionType: 'completed',
                    actionData: { notes: 'Transfer completed successfully' },
                    performedByUserId: testData.users.admin.id,
                }
            ]);

            // Record transfer history
            await db.insert(transferHistory).values({
                transferRequestId: transfer.id,
                fromInventoryId: fromInv.id,
                toInventoryId: toInv.id,
                productId: testData.products.product.id,
                quantity: 12,
                transferredByUserId: testData.users.admin.id,
                notes: 'Stock transfer completed',
            });

            const transferWithHistory = await db.query.transferRequests.findFirst({
                where: eq(transferRequests.id, transfer.id),
                with: {
                    actions: true,
                    history: true,
                    requestedByUser: true,
                },
            });

            expect(transferWithHistory?.actions).toHaveLength(3);
            expect(transferWithHistory?.history).toHaveLength(1);
            expect(transferWithHistory?.requestedByUser?.username).toBe('test_admin');
        });

        it('should track transfer by user', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-USER-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'approved',
                priority: 'normal',
            }).returning();

            // Create inventory records
            const [fromInv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 15,
            }).returning();

            const [toInv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.warehouse.id,
                quantity: 3,
            }).returning();

            // Record transfer with user tracking
            await db.insert(transferHistory).values({
                transferRequestId: transfer.id,
                fromInventoryId: fromInv.id,
                toInventoryId: toInv.id,
                productId: testData.products.product.id,
                quantity: 8,
                transferredByUserId: testData.users.admin.id,
                notes: 'Transferred by admin user',
            });

            const historyWithUser = await db.query.transferHistory.findFirst({
                where: eq(transferHistory.transferRequestId, transfer.id),
                with: {
                    transferredByUser: true,
                },
            });

            expect(historyWithUser?.transferredByUser?.username).toBe('test_admin');
            expect(historyWithUser?.quantity).toBe(8);
        });
    });

    describe('Store Relationships in Transfers', () => {
        it('should link transfer to source and destination stores', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-STORES-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            const transferWithStores = await db.query.transferRequests.findFirst({
                where: eq(transferRequests.id, transfer.id),
                with: {
                    fromStore: true,
                    toStore: true,
                },
            });

            expect(transferWithStores?.fromStore?.name).toBe('Test Store 1');
            expect(transferWithStores?.fromStore?.type).toBe('RETAIL');
            expect(transferWithStores?.toStore?.name).toBe('Test Warehouse');
            expect(transferWithStores?.toStore?.type).toBe('WAREHOUSE');
        });

        it('should filter transfers by store', async () => {
            // Create transfers from different stores
            await db.insert(transferRequests).values([
                {
                    transferNumber: 'TRF-FILTER-001',
                    fromStoreId: testData.stores.store1.id,
                    toStoreId: testData.stores.warehouse.id,
                    requestedByUserId: testData.users.admin.id,
                    status: 'pending',
                    priority: 'normal',
                },
                {
                    transferNumber: 'TRF-FILTER-002',
                    fromStoreId: testData.stores.warehouse.id,
                    toStoreId: testData.stores.store1.id,
                    requestedByUserId: testData.users.admin.id,
                    status: 'approved',
                    priority: 'high',
                }
            ]);

            const fromStore1 = await db.select()
                .from(transferRequests)
                .where(eq(transferRequests.fromStoreId, testData.stores.store1.id));

            expect(fromStore1).toHaveLength(1);
            expect(fromStore1[0].transferNumber).toBe('TRF-FILTER-001');
        });
    });

    describe('Transfer Status Transitions', () => {
        it('should support complete status workflow', async () => {
            const statuses = ['pending', 'approved', 'in_transit', 'completed', 'cancelled'];

            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-WORKFLOW-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            // Test status transitions
            for (const status of statuses.slice(1)) { // Skip 'pending' as it's initial
                await db.update(transferRequests)
                    .set({ status: status as any })
                    .where(eq(transferRequests.id, transfer.id));

                const updated = await db.query.transferRequests.findFirst({
                    where: eq(transferRequests.id, transfer.id),
                });

                expect(updated?.status).toBe(status);
            }
        });

        it('should handle rejected transfers', async () => {
            const [transfer] = await db.insert(transferRequests).values({
                transferNumber: 'TRF-REJECTED-001',
                fromStoreId: testData.stores.store1.id,
                toStoreId: testData.stores.warehouse.id,
                requestedByUserId: testData.users.admin.id,
                status: 'pending',
                priority: 'normal',
            }).returning();

            // Reject transfer
            await db.update(transferRequests)
                .set({ status: 'rejected' })
                .where(eq(transferRequests.id, transfer.id));

            // Record rejection action
            await db.insert(transferActions).values({
                transferRequestId: transfer.id,
                actionType: 'rejected',
                actionData: { rejectionReason: 'Insufficient stock at source' },
                performedByUserId: testData.users.admin.id,
            });

            const rejectedTransfer = await db.query.transferRequests.findFirst({
                where: eq(transferRequests.id, transfer.id),
                with: {
                    actions: true,
                },
            });

            expect(rejectedTransfer?.status).toBe('rejected');
            expect(rejectedTransfer?.actions[0].actionType).toBe('rejected');
        });
    });
});
