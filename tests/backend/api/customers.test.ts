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
                phoneNumber: '0901234567',
                name: 'John Doe',
                email: 'john@example.com',
                address: '123 Test Street',
                petType: 'DOG',
            }).returning();

            expect(customer).toBeDefined();
            expect(customer.phoneNumber).toBe('0901234567');
            expect(customer.name).toBe('John Doe');
            expect(customer.email).toBe('john@example.com');
            expect(customer.petType).toBe('DOG');
        });

        it('should create customer with optional fields', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0909876543',
                name: 'Jane Smith',
                email: 'jane@example.com',
                address: '456 Customer Ave',
                petType: 'CAT',
                photo: 'profile.jpg',
            }).returning();

            expect(customer.photo).toBe('profile.jpg');
        });

        it('should enforce unique phone numbers', async () => {
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

        it('should support both CAT and DOG pet types', async () => {
            const [catCustomer] = await db.insert(customerProfiles).values({
                phoneNumber: '0902222222',
                name: 'Cat Owner',
                email: 'cat@example.com',
                address: '123 Cat St',
                petType: 'CAT',
            }).returning();

            const [dogCustomer] = await db.insert(customerProfiles).values({
                phoneNumber: '0903333333',
                name: 'Dog Owner',
                email: 'dog@example.com',
                address: '456 Dog Ave',
                petType: 'DOG',
            }).returning();

            expect(catCustomer.petType).toBe('CAT');
            expect(dogCustomer.petType).toBe('DOG');
        });
    });

    describe('Customer Profile Updates', () => {
        it('should update customer information', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0904444444',
                name: 'Original Name',
                email: 'original@example.com',
                address: 'Original Address',
                petType: 'DOG',
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

        it('should update pet information', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0905555555',
                name: 'Pet Owner',
                email: 'pet@example.com',
                address: 'Pet Address',
                petType: 'DOG',
            }).returning();

            const [updated] = await db.update(customerProfiles)
                .set({
                    petType: 'CAT',
                    photo: 'new-pet-photo.jpg',
                })
                .where(eq(customerProfiles.id, customer.id))
                .returning();

            expect(updated.petType).toBe('CAT');
            expect(updated.photo).toBe('new-pet-photo.jpg');
        });
    });

    describe('Customer Search and Retrieval', () => {
        beforeEach(async () => {
            // Create test customers for search tests
            await db.insert(customerProfiles).values([
                {
                    phoneNumber: '0901111111',
                    name: 'John Smith',
                    email: 'john@example.com',
                    address: '123 Main St',
                    petType: 'DOG',
                },
                {
                    phoneNumber: '0902222222',
                    name: 'Jane Johnson',
                    email: 'jane@example.com',
                    address: '456 Oak Ave',
                    petType: 'CAT',
                },
                {
                    phoneNumber: '0903333333',
                    name: 'Bob Wilson',
                    email: 'bob@example.com',
                    address: '789 Pine St',
                    petType: 'DOG',
                }
            ]);
        });

        it('should find customer by phone number', async () => {
            const customer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.phoneNumber, '0901111111'),
            });

            expect(customer).toBeDefined();
            expect(customer?.name).toBe('John Smith');
        });

        it('should find customers by name (partial match)', async () => {
            const customers = await db.select()
                .from(customerProfiles)
                .where(like(customerProfiles.name, '%John%'));

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

        it('should find customers by pet type', async () => {
            const dogCustomers = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.petType, 'DOG'));

            expect(dogCustomers).toHaveLength(2);
            expect(dogCustomers.every(c => c.petType === 'DOG')).toBe(true);
        });
    });

    describe('Customer Purchase History', () => {
        it('should link customer to sales transactions', async () => {
            // Create customer
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0906666666',
                name: 'Purchase Customer',
                email: 'purchase@example.com',
                address: 'Purchase Address',
                petType: 'DOG',
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
                phoneNumber: '0907777777',
                name: 'Total Customer',
                email: 'total@example.com',
                address: 'Total Address',
                petType: 'CAT',
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
                    petType: 'DOG',
                    // Missing phoneNumber
                } as any);
            }).rejects.toThrow();
        });

        it('should require name', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    phoneNumber: '0908888888',
                    email: 'noname@example.com',
                    address: 'No Name Address',
                    petType: 'DOG',
                    // Missing name
                } as any);
            }).rejects.toThrow();
        });

        it('should require email', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    phoneNumber: '0909999999',
                    name: 'No Email Customer',
                    address: 'No Email Address',
                    petType: 'DOG',
                    // Missing email
                } as any);
            }).rejects.toThrow();
        });

        it('should require address', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    phoneNumber: '0900000000',
                    name: 'No Address Customer',
                    email: 'noaddress@example.com',
                    petType: 'DOG',
                    // Missing address
                } as any);
            }).rejects.toThrow();
        });

        it('should require pet type', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    phoneNumber: '0901212121',
                    name: 'No Pet Customer',
                    email: 'nopet@example.com',
                    address: 'No Pet Address',
                    // Missing petType
                } as any);
            }).rejects.toThrow();
        });

        it('should validate pet type values', async () => {
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    phoneNumber: '0901313131',
                    name: 'Invalid Pet Customer',
                    email: 'invalidpet@example.com',
                    address: 'Invalid Pet Address',
                    petType: 'INVALID' as any, // Invalid pet type
                });
            }).rejects.toThrow();
        });
    });

    describe('Customer Profile Deletion', () => {
        it('should delete customer profile', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                phoneNumber: '0901414141',
                name: 'Delete Customer',
                email: 'delete@example.com',
                address: 'Delete Address',
                petType: 'DOG',
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
                phoneNumber: '0901515151',
                name: 'Transaction Customer',
                email: 'transaction@example.com',
                address: 'Transaction Address',
                petType: 'CAT',
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
                phoneNumber: '0901616161',
                name: 'Analytics Customer 1',
                email: 'analytics1@example.com',
                address: 'Analytics Address 1',
                petType: 'DOG',
            }).returning();

            const [customer2] = await db.insert(customerProfiles).values({
                phoneNumber: '0901717171',
                name: 'Analytics Customer 2',
                email: 'analytics2@example.com',
                address: 'Analytics Address 2',
                petType: 'CAT',
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

        it('should count customers by pet type', async () => {
            const dogCustomers = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.petType, 'DOG'));

            const catCustomers = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.petType, 'CAT'));

            expect(dogCustomers.length).toBeGreaterThanOrEqual(1);
            expect(catCustomers.length).toBeGreaterThanOrEqual(1);
        });

        it('should calculate customer lifetime value', async () => {
            const customer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.phoneNumber, '0901616161'),
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
