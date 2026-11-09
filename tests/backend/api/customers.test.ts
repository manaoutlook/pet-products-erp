import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { customerProfiles, salesTransactions } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData, resetTestDatabase } from '../../helpers/test-db';
import { eq, like } from 'drizzle-orm';

describe('Customer Management Tests', () => {
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

    describe('Customer Profile Creation', () => {
        it('should create a new customer profile', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0901234567',
                name: 'John Doe',
                email: 'john@example.com',
                address: '123 Test Street',
                customerType: 'B2C',
            }).returning();

            expect(customer).toBeDefined();
            expect(customer.mobileNumber).toBe('0901234567');
            expect(customer.name).toBe('John Doe');
            expect(customer.email).toBe('john@example.com');
            expect(customer.customerType).toBe('B2C');
        });

        it('should create customer with optional fields', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0909876543',
                name: 'Jane Smith',
                email: 'jane@example.com',
                address: '456 Customer Ave',
                customerType: 'B2B',
                photo: 'profile.jpg',
            }).returning();

            expect(customer.photo).toBe('profile.jpg');
        });

        it('should enforce unique mobile numbers', async () => {
            // Create first customer
            await db.insert(customerProfiles).values({
                mobileNumber: '0901111111',
                name: 'John Doe',
                email: 'john@example.com',
                address: '123 Test St',
                customerType: 'B2C',
            });

            // Try to create duplicate mobile number
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0901111111', // Same mobile
                    name: 'Jane Doe',
                    email: 'jane@example.com',
                    address: '456 Test St',
                    customerType: 'B2B',
                });
            }).rejects.toThrow();
        });

        it('should support both B2B and B2C customer types', async () => {
            const [businessCustomer] = await db.insert(customerProfiles).values({
                mobileNumber: '0902222222',
                name: 'Business Buyer',
                email: 'business@example.com',
                address: '123 Trade St',
                customerType: 'B2B',
            }).returning();

            const [consumerCustomer] = await db.insert(customerProfiles).values({
                mobileNumber: '0903333333',
                name: 'Consumer Buyer',
                email: 'consumer@example.com',
                address: '456 Market Ave',
                customerType: 'B2C',
            }).returning();

            expect(businessCustomer.customerType).toBe('B2B');
            expect(consumerCustomer.customerType).toBe('B2C');
        });
    });

    describe('Customer Profile Updates', () => {
        it('should update customer information', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0904444444',
                name: 'Original Name',
                email: 'original@example.com',
                address: 'Original Address',
                customerType: 'B2C',
            }).returning();

            const [updated] = await db.update(customerProfiles)
                .set({
                    name: 'Updated Name',
                    email: 'updated@example.com',
                    address: 'Updated Address',
                })
                .where(eq(customerProfiles.id, customer.id))
                .returning();

            expect(updated.name).toBe('Updated Name');
            expect(updated.email).toBe('updated@example.com');
            expect(updated.address).toBe('Updated Address');
        });

        it('should update customer account information', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0905555555',
                name: 'Account Holder',
                email: 'account@example.com',
                address: 'Account Address',
                customerType: 'B2C',
            }).returning();

            const [updated] = await db.update(customerProfiles)
                .set({
                    customerType: 'B2B',
                    landLineNumber: '02838221234',
                    photo: 'new-account-photo.jpg',
                })
                .where(eq(customerProfiles.id, customer.id))
                .returning();

            expect(updated.customerType).toBe('B2B');
            expect(updated.landLineNumber).toBe('02838221234');
            expect(updated.photo).toBe('new-account-photo.jpg');
        });
    });

    describe('Customer Search and Retrieval', () => {
        beforeEach(async () => {
            // Create test customers for search tests
            await db.insert(customerProfiles).values([
                {
                    mobileNumber: '0901111111',
                    name: 'John Smith',
                    email: 'john@example.com',
                    address: '123 Main St',
                    customerType: 'B2C',
                },
                {
                    mobileNumber: '0902222222',
                    name: 'Jane Johnson',
                    email: 'jane@example.com',
                    address: '456 Oak Ave',
                    customerType: 'B2B',
                },
                {
                    mobileNumber: '0903333333',
                    name: 'Bob Wilson',
                    email: 'bob@example.com',
                    address: '789 Pine St',
                    customerType: 'B2C',
                }
            ]);
        });

        it('should find customer by mobile number', async () => {
            const customer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.mobileNumber, '0901111111'),
            });

            expect(customer).toBeDefined();
            expect(customer?.name).toBe('John Smith');
        });

        it('should find customers by name (partial match)', async () => {
            // 'John' alone also matches the 'Jane Johnson' fixture, so narrow the pattern to keep
            // this test about LIKE semantics rather than about substring collisions.
            const customers = await db.select()
                .from(customerProfiles)
                .where(like(customerProfiles.name, '%John Sm%'));

            expect(customers).toHaveLength(1);
            expect(customers[0].name).toBe('John Smith');
        });

        it('should find customers by email', async () => {
            const customer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.email, 'jane@example.com'),
            });

            expect(customer).toBeDefined();
            expect(customer?.name).toBe('Jane Johnson');
        });

        it('should find customers by customer type', async () => {
            const consumerCustomers = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.customerType, 'B2C'));

            expect(consumerCustomers).toHaveLength(2);
            expect(consumerCustomers.every(c => c.customerType === 'B2C')).toBe(true);
        });
    });

    describe('Customer Purchase History', () => {
        it('should link customer to sales transactions', async () => {
            // Create customer
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0906666666',
                name: 'Purchase Customer',
                email: 'purchase@example.com',
                address: 'Purchase Address',
                customerType: 'B2C',
            }).returning();

            // Create sales transactions for this customer
            await db.insert(salesTransactions).values([
                {
                    invoiceNumber: 'INV-CUST-001',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer.id,
                    totalAmount: '25000.00',
                    paymentMethod: 'CASH',
                    status: 'completed',
                },
                {
                    invoiceNumber: 'INV-CUST-002',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer.id,
                    totalAmount: '15000.00',
                    paymentMethod: 'CARD',
                    status: 'completed',
                }
            ]);

            const customerWithPurchases = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.id, customer.id),
                with: {
                    salesTransactions: true,
                },
            });

            expect(customerWithPurchases?.salesTransactions).toHaveLength(2);
            expect(customerWithPurchases?.salesTransactions[0].totalAmount).toBe('25000.00');
            expect(customerWithPurchases?.salesTransactions[1].totalAmount).toBe('15000.00');
        });

        it('should calculate customer total purchase amount', async () => {
            // Create customer
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0907777777',
                name: 'Total Customer',
                email: 'total@example.com',
                address: 'Total Address',
                customerType: 'B2B',
            }).returning();

            // Create transactions
            await db.insert(salesTransactions).values([
                {
                    invoiceNumber: 'INV-TOTAL-001',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer.id,
                    totalAmount: '30000.00',
                    paymentMethod: 'CASH',
                    status: 'completed',
                },
                {
                    invoiceNumber: 'INV-TOTAL-002',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer.id,
                    totalAmount: '20000.00',
                    paymentMethod: 'CARD',
                    status: 'completed',
                }
            ]);

            const transactions = await db.select()
                .from(salesTransactions)
                .where(eq(salesTransactions.customerProfileId, customer.id));

            const totalAmount = transactions.reduce((sum, t) => sum + parseFloat(t.totalAmount), 0);
            expect(totalAmount).toBe(50000);
        });
    });

    describe('Customer Data Validation', () => {
        it('should require phone number', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    name: 'No Phone Customer',
                    email: 'nophone@example.com',
                    address: 'No Phone Address',
                    customerType: 'B2C',
                    // Missing mobileNumber
                } as any);
            }).rejects.toThrow();
        });

        it('should require name', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0908888888',
                    email: 'noname@example.com',
                    address: 'No Name Address',
                    customerType: 'B2C',
                    // Missing name
                } as any);
            }).rejects.toThrow();
        });

        it('should require email', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0909999999',
                    name: 'No Email Customer',
                    address: 'No Email Address',
                    customerType: 'B2C',
                    // Missing email
                } as any);
            }).rejects.toThrow();
        });

        it('should require address', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0900000000',
                    name: 'No Address Customer',
                    email: 'noaddress@example.com',
                    customerType: 'B2C',
                    // Missing address
                } as any);
            }).rejects.toThrow();
        });

        it('should require customer type', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0901212121',
                    name: 'No Type Customer',
                    email: 'notype@example.com',
                    address: 'No Type Address',
                    // Missing customerType
                } as any);
            }).rejects.toThrow();
        });

        it('should reject unknown customer type values', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0901313131',
                    name: 'Invalid Type Customer',
                    email: 'invalidtype@example.com',
                    address: 'Invalid Type Address',
                    customerType: 'INVALID' as any, // Not a customer type
                });
            }).rejects.toThrow();
        });
    });

    describe('Customer Profile Deletion', () => {
        it('should delete customer profile', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0901414141',
                name: 'Delete Customer',
                email: 'delete@example.com',
                address: 'Delete Address',
                customerType: 'B2C',
            }).returning();

            await db.delete(customerProfiles).where(eq(customerProfiles.id, customer.id));

            const deleted = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.id, customer.id),
            });

            expect(deleted).toBeUndefined();
        });

        it('should handle customer deletion with existing transactions', async () => {
            // Create customer
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0901515151',
                name: 'Transaction Customer',
                email: 'transaction@example.com',
                address: 'Transaction Address',
                customerType: 'B2B',
            }).returning();

            // Create transaction for customer
            await db.insert(salesTransactions).values({
                invoiceNumber: 'INV-DELETE-001',
                storeId: testData.stores.store1.id,
                transactionType: 'STORE_SALE',
                cashierUserId: testData.users.admin.id,
                customerProfileId: customer.id,
                totalAmount: '10000.00',
                paymentMethod: 'CASH',
                status: 'completed',
            });

            // Try to delete customer (this should work - foreign key allows it)
            await db.delete(customerProfiles).where(eq(customerProfiles.id, customer.id));

            const deletedCustomer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.id, customer.id),
            });

            expect(deletedCustomer).toBeUndefined();

            // Transaction should still exist but with null customer reference
            const transaction = await db.query.salesTransactions.findFirst({
                where: eq(salesTransactions.invoiceNumber, 'INV-DELETE-001'),
            });

            expect(transaction).toBeDefined();
        });
    });

    describe('Customer Statistics and Analytics', () => {
        beforeEach(async () => {
            // Create test customers and transactions for analytics
            const [customer1] = await db.insert(customerProfiles).values({
                mobileNumber: '0901616161',
                name: 'Analytics Customer 1',
                email: 'analytics1@example.com',
                address: 'Analytics Address 1',
                customerType: 'B2C',
            }).returning();

            const [customer2] = await db.insert(customerProfiles).values({
                mobileNumber: '0901717171',
                name: 'Analytics Customer 2',
                email: 'analytics2@example.com',
                address: 'Analytics Address 2',
                customerType: 'B2B',
            }).returning();

            await db.insert(salesTransactions).values([
                {
                    invoiceNumber: 'INV-ANALYTICS-001',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer1.id,
                    totalAmount: '50000.00',
                    paymentMethod: 'CASH',
                    status: 'completed',
                },
                {
                    invoiceNumber: 'INV-ANALYTICS-002',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer1.id,
                    totalAmount: '30000.00',
                    paymentMethod: 'CARD',
                    status: 'completed',
                },
                {
                    invoiceNumber: 'INV-ANALYTICS-003',
                    storeId: testData.stores.store1.id,
                    transactionType: 'STORE_SALE',
                    cashierUserId: testData.users.admin.id,
                    customerProfileId: customer2.id,
                    totalAmount: '40000.00',
                    paymentMethod: 'CASH',
                    status: 'completed',
                }
            ]);
        });

        it('should count total customers', async () => {
            const customers = await db.select().from(customerProfiles);
            expect(customers.length).toBeGreaterThanOrEqual(2);
        });

        it('should count customers by customer type', async () => {
            const consumerCustomers = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.customerType, 'B2C'));

            const businessCustomers = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.customerType, 'B2B'));

            expect(consumerCustomers.length).toBeGreaterThanOrEqual(1);
            expect(businessCustomers.length).toBeGreaterThanOrEqual(1);
        });

        it('should calculate customer lifetime value', async () => {
            const customer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.mobileNumber, '0901616161'),
                with: {
                    salesTransactions: true,
                },
            });

            const lifetimeValue = customer?.salesTransactions?.reduce(
                (sum, transaction) => sum + parseFloat(transaction.totalAmount),
                0
            );

            expect(lifetimeValue).toBe(80000); // 50000 + 30000
        });
    });
});
