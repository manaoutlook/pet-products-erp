import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { salesTransactions, salesTransactionItems, salesTransactionActions, customerProfiles, inventory } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';

describe('Point of Sale (POS) Tests', () => {
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

    describe('Sales Transaction Creation', () => {
        it('should create a new sales transaction', async () => {
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-TEST-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '25000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            expect(transaction).toBeDefined();
            expect(transaction.invoiceNumber).toBe('INV-TEST-001');
            expect(transaction.transactionType).toBe('STORE_SALE');
            expect(transaction.status).toBe('completed');
            expect(transaction.totalAmount).toBe('25000.00');
        });

        it('should enforce unique invoice numbers', async () => {
            // Create first transaction
            await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-DUP-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '15000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            });

            // Try to create duplicate
            await expect(async () => {
                await db.insert(salesTransactions).values({
                    invoiceNumber: 'INV-DUP-001', // Same invoice number
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    totalAmount: '20000.00',
                    paymentMethod: 'CARD',
                    status: 'completed',
                });
            }).rejects.toThrow();
        });

        it('should create transaction with line items', async () => {
            // First create inventory for the product
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 10,
            }).returning();

            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-ITEMS-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '20000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            // Add line items
            await db.insert(salesTransactionItems).values([
                {
                    salesTransactionId: transaction.id,
                    productId: testData.products.product.id,
                    inventoryId: inv.id,
                    quantity: 2,
                    unitPrice: '5000.00',
                    totalPrice: '10000.00',
                },
                {
                    salesTransactionId: transaction.id,
                    productId: testData.products.product.id,
                    inventoryId: inv.id,
                    quantity: 1,
                    unitPrice: '10000.00',
                    totalPrice: '10000.00',
                }
            ]);

            const transactionWithItems = await db.query.salesTransactions.findFirst({
                where: eq(salesTransactions.id, transaction.id),
                with: {
                    items: true,
                },
            });

            expect(transactionWithItems?.items).toHaveLength(2);
            expect(transactionWithItems?.items[0].quantity).toBe(2);
            expect(transactionWithItems?.items[1].quantity).toBe(1);
        });
    });

    describe('Customer Integration', () => {
        it('should create customer profile', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0901234567',
                name: 'John Doe',
                email: 'john@example.com',
                address: '123 Test St',
                petType: 'DOG',
            }).returning();

            expect(customer).toBeDefined();
            expect(customer.phoneNumber).toBe('0901234567');
            expect(customer.name).toBe('John Doe');
            expect(customer.petType).toBe('DOG');
        });

        it('should enforce unique phone numbers for customers', async () => {
            // Create first customer
            await db.insert(customerProfiles).values({
                phoneNumber: '0901111111',
                name: 'John Doe',
                email: 'john@example.com',
                address: '123 Test St',
                petType: 'DOG',
            });

            // Try to create duplicate phone
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    phoneNumber: '0901111111', // Same phone
                    name: 'Jane Doe',
                    email: 'jane@example.com',
                    address: '456 Test St',
                    petType: 'CAT',
                });
            }).rejects.toThrow();
        });

        it('should link transaction to customer', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0902222222',
                name: 'Jane Smith',
                email: 'jane@example.com',
                address: '456 Customer St',
                petType: 'CAT',
            }).returning();

            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-CUSTOMER-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                customerProfileId: customer.id,
                totalAmount: '35000.00',
                paymentMethod: 'CARD',
                status: 'completed',
            }).returning();

            const transactionWithCustomer = await db.query.salesTransactions.findFirst({
                where: eq(salesTransactions.id, transaction.id),
                with: {
                    customerProfile: true,
                },
            });

            expect(transactionWithCustomer?.customerProfile?.name).toBe('Jane Smith');
            expect(transactionWithCustomer?.customerProfile?.phoneNumber).toBe('0902222222');
        });
    });

    describe('Payment Methods', () => {
        it('should support multiple payment methods', async () => {
            const paymentMethods = ['CASH', 'CARD', 'BANK_TRANSFER'];

            for (const method of paymentMethods) {
                const [transaction] = await db.insert(salesTransactions).values({
                    invoiceNumber: `INV-${method}-001`,
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    totalAmount: '15000.00',
                    paymentMethod: method as any,
                    status: 'completed',
                }).returning();

                expect(transaction.paymentMethod).toBe(method);
            }
        });
    });

    describe('Transaction Status Management', () => {
        it('should handle transaction refunds', async () => {
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-REFUND-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '20000.00',
                paymentMethod: 'CARD',
                status: 'completed',
            }).returning();

            // Update to refunded
            const [refunded] = await db.update(salesTransactions)
                .set({ status: 'refunded' })
                .where(eq(salesTransactions.id, transaction.id))
                .returning();

            expect(refunded.status).toBe('refunded');
        });

        it('should handle transaction voids', async () => {
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-VOID-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '18000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            // Update to voided
            const [voided] = await db.update(salesTransactions)
                .set({ status: 'voided' })
                .where(eq(salesTransactions.id, transaction.id))
                .returning();

            expect(voided.status).toBe('voided');
        });
    });

    describe('Transaction Actions and Audit', () => {
        it('should track transaction actions', async () => {
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-AUDIT-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '22000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            // Add refund action
            await db.insert(salesTransactionActions).values({
                salesTransactionId: transaction.id,
                actionType: 'refund',
                actionData: { notes: 'Customer returned item - faulty product' },
                performedByUserId: testData.users.admin.id,
            });

            const transactionWithActions = await db.query.salesTransactions.findFirst({
                where: eq(salesTransactions.id, transaction.id),
                with: {
                    actions: true,
                },
            });

            expect(transactionWithActions?.actions).toHaveLength(1);
            expect(transactionWithActions?.actions[0].actionType).toBe('refund');
        });
    });

    describe('Store-Specific Transactions', () => {
        it('should differentiate store vs warehouse sales', async () => {
            // Store sale
            const [storeSale] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-STORE-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '15000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            // Warehouse/DC sale
            const [warehouseSale] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-DC-001',
                storeId: testData.stores.warehouse.id,
                transactionType: 'DC_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '25000.00',
                paymentMethod: 'CARD',
                status: 'completed',
            }).returning();

            expect(storeSale.transactionType).toBe('STORE_SALE');
            expect(warehouseSale.transactionType).toBe('DC_SALE');
        });

        it('should link transactions to correct store', async () => {
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-STORE-LINK-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '12000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            const transactionWithStore = await db.query.salesTransactions.findFirst({
                where: eq(salesTransactions.id, transaction.id),
                with: {
                    store: true,
                },
            });

            expect(transactionWithStore?.store?.name).toBe('Test Store 1');
            expect(transactionWithStore?.store?.type).toBe('RETAIL');
        });
    });

    describe('Cashier Tracking', () => {
        it('should track which user processed the sale', async () => {
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-CASHIER-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '28000.00',
                paymentMethod: 'BANK_TRANSFER',
                status: 'completed',
            }).returning();

            const transactionWithCashier = await db.query.salesTransactions.findFirst({
                where: eq(salesTransactions.id, transaction.id),
                with: {
                    cashierUser: true,
                },
            });

            expect(transactionWithCashier?.cashierUser?.username).toBe('test_admin');
        });
    });

    describe('Inventory Deduction', () => {
        it('should link sale items to specific inventory', async () => {
            // Create inventory
            const [inv] = await db.insert(inventory).values({
                productId: testData.products.product.id,
                storeId: testData.stores.store1.id,
                quantity: 5,
            }).returning();

            // Create transaction
            const [transaction] = await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-INVENTORY-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                totalAmount: '10000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            }).returning();

            // Add sale item linked to specific inventory
            await db.insert(salesTransactionItems).values({
                salesTransactionId: transaction.id,
                productId: testData.products.product.id,
                inventoryId: inv.id,
                quantity: 2,
                unitPrice: '5000.00',
                totalPrice: '10000.00',
            });

            const saleItem = await db.query.salesTransactionItems.findFirst({
                where: eq(salesTransactionItems.salesTransactionId, transaction.id),
                with: {
                    inventory: true,
                },
            });

            expect(saleItem?.inventory?.id).toBe(inv.id);
            expect(saleItem?.quantity).toBe(2);
        });
    });
});
