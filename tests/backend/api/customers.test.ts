import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { db } from '../../../db';
import { customerProfiles, salesTransactions, insertCustomerProfileSchema } from '../../../db/schema';
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
                contactPerson: 'John Doe',
                email: 'john@example.com',
                address: '123 Test Street',
                customerType: 'B2C',
            }).returning();

            expect(customer).toBeDefined();
            expect(customer.mobileNumber).toBe('0901234567');
            expect(customer.contactPerson).toBe('John Doe');
            expect(customer.email).toBe('john@example.com');
            expect(customer.customerType).toBe('B2C');
        });

        it('should create customer with optional fields', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0909876543',
                contactPerson: 'Jane Smith',
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
                contactPerson: 'John Doe',
                email: 'john@example.com',
                address: '123 Test St',
                customerType: 'B2C',
            });

            // Try to create duplicate mobile number
            await expect(async () => {
                await db.insert(customerProfiles).values({
                    mobileNumber: '0901111111', // Same mobile
                    contactPerson: 'Jane Doe',
                    email: 'jane@example.com',
                    address: '456 Test St',
                    customerType: 'B2B',
                });
            }).rejects.toThrow();
        });

        it('should support both B2B and B2C customer types', async () => {
            const [businessCustomer] = await db.insert(customerProfiles).values({
                mobileNumber: '0902222222',
                contactPerson: 'Business Buyer',
                email: 'business@example.com',
                address: '123 Trade St',
                customerType: 'B2B',
            }).returning();

            const [consumerCustomer] = await db.insert(customerProfiles).values({
                mobileNumber: '0903333333',
                contactPerson: 'Consumer Buyer',
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
                contactPerson: 'Original Name',
                email: 'original@example.com',
                address: 'Original Address',
                customerType: 'B2C',
            }).returning();

            const [updated] = await db.update(customerProfiles)
                .set({
                    contactPerson: 'Updated Name',
                    email: 'updated@example.com',
                    address: 'Updated Address',
                })
                .where(eq(customerProfiles.id, customer.id))
                .returning();

            expect(updated.contactPerson).toBe('Updated Name');
            expect(updated.email).toBe('updated@example.com');
            expect(updated.address).toBe('Updated Address');
        });

        it('should store the company name separately from the contact person', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0904848484',
                companyName: 'Acme Pet Supplies Co.',
                contactPerson: 'Tran Van Binh',
                email: 'binh@acmepet.example',
                address: '12 Le Loi, District 1, Ho Chi Minh City',
                customerType: 'B2B',
            }).returning();

            expect(customer.companyName).toBe('Acme Pet Supplies Co.');
            expect(customer.contactPerson).toBe('Tran Van Binh');

            const [updated] = await db.update(customerProfiles)
                .set({ companyName: 'Acme Pet Supplies JSC' })
                .where(eq(customerProfiles.id, customer.id))
                .returning();

            expect(updated.companyName).toBe('Acme Pet Supplies JSC');
            // Renaming the account must not rewrite who we deal with.
            expect(updated.contactPerson).toBe('Tran Van Binh');
        });

        it('should leave the company name empty for a walk-in consumer', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0904949494',
                contactPerson: 'Le Thi Cam',
                email: 'cam@example.com',
                address: '99 Hai Ba Trung, District 3, Ho Chi Minh City',
                customerType: 'B2C',
            }).returning();

            expect(customer.companyName).toBeNull();
        });

        it('should update customer account information', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0905555555',
                contactPerson: 'Account Holder',
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
                    contactPerson: 'John Smith',
                    email: 'john@example.com',
                    address: '123 Main St',
                    customerType: 'B2C',
                },
                {
                    mobileNumber: '0902222222',
                    contactPerson: 'Jane Johnson',
                    email: 'jane@example.com',
                    address: '456 Oak Ave',
                    customerType: 'B2B',
                },
                {
                    mobileNumber: '0903333333',
                    contactPerson: 'Bob Wilson',
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
            expect(customer?.contactPerson).toBe('John Smith');
        });

        it('should find customers by name (partial match)', async () => {
            // 'John' alone also matches the 'Jane Johnson' fixture, so narrow the pattern to keep
            // this test about LIKE semantics rather than about substring collisions.
            const customers = await db.select()
                .from(customerProfiles)
                .where(like(customerProfiles.contactPerson, '%John Sm%'));

            expect(customers).toHaveLength(1);
            expect(customers[0].contactPerson).toBe('John Smith');
        });

        it('should find customers by email', async () => {
            const customer = await db.query.customerProfiles.findFirst({
                where: eq(customerProfiles.email, 'jane@example.com'),
            });

            expect(customer).toBeDefined();
            expect(customer?.contactPerson).toBe('Jane Johnson');
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
                contactPerson: 'Purchase Customer',
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
                contactPerson: 'Total Customer',
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
                    contactPerson: 'No Phone Customer',
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
                    contactPerson: 'No Email Customer',
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
                    contactPerson: 'No Address Customer',
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
                    contactPerson: 'No Type Customer',
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
                    contactPerson: 'Invalid Type Customer',
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
                contactPerson: 'Delete Customer',
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
                contactPerson: 'Transaction Customer',
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
                contactPerson: 'Analytics Customer 1',
                email: 'analytics1@example.com',
                address: 'Analytics Address 1',
                customerType: 'B2C',
            }).returning();

            const [customer2] = await db.insert(customerProfiles).values({
                mobileNumber: '0901717171',
                contactPerson: 'Analytics Customer 2',
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

    describe('Phone Number Normalisation', () => {
        const baseProfile = {
            contactPerson: 'Nguyen Thi An',
            email: 'an.nguyen@example.com',
            address: '804 Cong Quynh, District 1, Ho Chi Minh City',
            customerType: 'B2C' as const,
        };

        it('stores a mobile number without the separators the user pasted', () => {
            const parsed = insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '+84-930-123-456',
            });

            expect(parsed.mobileNumber).toBe('+84930123456');
        });

        it('normalises the optional land line in the same way', () => {
            const parsed = insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '0901234567',
                landLineNumber: '+84 28 1234 567',
            });

            expect(parsed.landLineNumber).toBe('+84281234567');
        });

        it('leaves the land line null when it is not supplied', () => {
            const parsed = insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '0901234567',
            });

            expect(parsed.landLineNumber).toBeNull();
        });

        it('rejects a mobile number that is only separators', () => {
            expect(() => insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '+ - ',
            })).toThrow();
        });

        it('trims the company name and stores a blank one as null', () => {
            const parsed = insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '0901234567',
                companyName: '  Acme Pet Supplies Co.  ',
            });

            expect(parsed.companyName).toBe('Acme Pet Supplies Co.');

            // A B2C walk-in leaves the box empty; the column is nullable, not "".
            const blank = insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '0901234567',
                companyName: '   ',
            });

            expect(blank.companyName).toBeNull();
        });

        it('still requires a contact person', () => {
            expect(() => insertCustomerProfileSchema.parse({
                ...baseProfile,
                mobileNumber: '0901234567',
                contactPerson: '',
            })).toThrow();
        });
    });

    // A VAT invoice prints the buyer's tax code (mã số thuế). The POS fills the buyer block from
    // the selected customer profile, so the code has to live on the profile - and it has to be
    // stored in the one form an invoice can print, not however the customer spelled it out.
    describe('Tax Code (VAT invoice buyer)', () => {
        const businessProfile = {
            mobileNumber: '0901234567',
            companyName: 'Conqueror Trading Co.',
            contactPerson: 'Le Thi Hoa',
            email: 'hoa@conqueror.example',
            address: '1 Nguyen Hue, District 1, Ho Chi Minh City',
            customerType: 'B2B' as const,
        };

        it('stores the tax code on the profile', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                ...businessProfile,
                taxId: '0313623838',
            }).returning();

            expect(customer.taxId).toBe('0313623838');
        });

        it('leaves the tax code empty for a consumer who has none', async () => {
            const [customer] = await db.insert(customerProfiles).values({
                mobileNumber: '0901234568',
                contactPerson: 'Nguyen Thi Mai',
                email: 'mai@example.com',
                address: '99 Hai Ba Trung, District 3',
                customerType: 'B2C',
            }).returning();

            // NOT NULL DEFAULT '': "no tax code" is one representation, not '' vs NULL.
            expect(customer.taxId).toBe('');
        });

        it('drops the grouping spaces the tax office prints', () => {
            const parsed = insertCustomerProfileSchema.parse({
                ...businessProfile,
                taxId: '0313 623 838',
            });

            expect(parsed.taxId).toBe('0313623838');
        });

        it('keeps the dash of a branch suffix', () => {
            const parsed = insertCustomerProfileSchema.parse({
                ...businessProfile,
                taxId: '0313623838-001',
            });

            expect(parsed.taxId).toBe('0313623838-001');
        });

        it('rejects a code that is not 10 digits plus an optional branch suffix', () => {
            expect(() => insertCustomerProfileSchema.parse({
                ...businessProfile,
                taxId: '03136238', // eight digits - one keystroke short on an invoice
            })).toThrow();
        });
    });
});
