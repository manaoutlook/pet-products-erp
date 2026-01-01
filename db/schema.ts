import { pgTable, text, serial, integer, boolean, timestamp, date, varchar, decimal } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { jsonb } from "drizzle-orm/pg-core";


type Permissions = {
  products: { create: boolean; read: boolean; update: boolean; delete: boolean };
  orders: { create: boolean; read: boolean; update: boolean; delete: boolean };
  inventory: { create: boolean; read: boolean; update: boolean; delete: boolean };
  users: { create: boolean; read: boolean; update: boolean; delete: boolean };
  stores: { create: boolean; read: boolean; update: boolean; delete: boolean };
  masterData: { create: boolean; read: boolean; update: boolean; delete: boolean };
  pos: { create: boolean; read: boolean; update: boolean; delete: boolean };
  receipts: { create: boolean; read: boolean; update: boolean; delete: boolean };
};

// Roles table with proper JSONB handling and hierarchy levels
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  description: text("description"),
  isSystemAdmin: boolean("is_system_admin").notNull().default(false),
  hierarchyLevel: text("hierarchy_level").notNull().default('staff'), // 'staff', 'regional_manager', 'global_manager', 'admin'
  permissions: jsonb("permissions").$type<Permissions>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Regions table - For hierarchical access control
export const regions = pgTable("regions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  managerUserId: integer("manager_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  roleId: integer("role_id").references(() => roles.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Stores table - Supports both RETAIL outlets and WAREHOUSES (Distribution Centers)
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  regionId: integer("region_id").references(() => regions.id), // For hierarchical access control
  // AI Agent Note: 'type' distinguishes between retail shops and distribution centers/warehouses.
  // Both are treated as 'stores' to reuse transfer and inventory logic.
  type: text("type").notNull().default('RETAIL'), // 'RETAIL' or 'WAREHOUSE'
  location: text("location").notNull(),
  contactInfo: text("contact_info").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Store Assignments table
export const userStoreAssignments = pgTable("user_store_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  storeId: integer("store_id").references(() => stores.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Brands table for product branding
export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Suppliers table for inventory management
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactInfo: text("contact_info").notNull(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Categories table for product categorization
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Products table with proper category and brand relationships
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sku: text("sku").unique().notNull(),
  price: decimal("price", { precision: 15, scale: 2 }).notNull(), // VND amount
  categoryId: integer("category_id").references(() => categories.id).notNull(),
  brandId: integer("brand_id").references(() => brands.id),
  minStock: integer("min_stock").notNull().default(10),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Inventory table with all required fields
export const inventory = pgTable("inventory", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => products.id),
  storeId: integer("store_id").references(() => stores.id),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  quantity: integer("quantity").notNull().default(0),
  location: text("location"),
  inventoryType: text("inventory_type").notNull().default('DC'),
  centerId: text("center_id").default('DC001'),
  barcode: text("barcode").unique(),
  purchaseDate: date("purchase_date"),
  expiryDate: date("expiry_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Orders table
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  status: text("status").notNull().default('pending'),
  storeId: integer("store_id").references(() => stores.id),
  total: decimal("total", { precision: 15, scale: 2 }).notNull(), // VND amount
  customerProfileId: integer("customer_profile_id").references(() => customerProfiles.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Order Items table
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id),
  productId: integer("product_id").references(() => products.id),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 15, scale: 2 }).notNull(), // VND amount
});

// Purchase Orders table
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("order_number", { length: 50 }).notNull().unique(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  // AI Agent Note: destinationStoreId refers to the Warehouse/DC where the goods will be received.
  destinationStoreId: integer("destination_store_id").references(() => stores.id),
  orderDate: timestamp("order_date").notNull().defaultNow(),
  deliveryDate: timestamp("delivery_date"),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(), // VND amount
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Purchase Order Items table
export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  totalPrice: decimal("total_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  deliveredQuantity: integer("delivered_quantity").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Purchase Order Actions table for tracking order processes
export const purchaseOrderActions = pgTable("purchase_order_actions", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(), // 'cancel', 'print', 'invoice_received', 'payment_sent', 'goods_receipt'
  actionData: jsonb("action_data").$type<{ notes?: string, quantity?: number, reference?: string }>(),
  performedByUserId: integer("performed_by_user_id").references(() => users.id).notNull(),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Customer Profiles table
export const customerProfiles = pgTable("customer_profiles", {
  id: serial("id").primaryKey(),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull().unique(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  address: text("address").notNull(),
  photo: text("photo"),
  petBirthday: date("pet_birthday"),
  petType: varchar("pet_type", { length: 10 }).notNull(), // 'CAT' or 'DOG'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invoice Counters table - Store-specific invoice numbering
export const invoiceCounters = pgTable("invoice_counters", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => stores.id),
  counterType: varchar("counter_type", { length: 10 }).notNull(), // 'STORE' or 'DC'
  currentNumber: integer("current_number").notNull().default(0),
  prefix: varchar("prefix", { length: 20 }).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// Sales Transactions table - POS sales records
export const salesTransactions = pgTable("sales_transactions", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  storeId: integer("store_id").references(() => stores.id),
  transactionType: varchar("transaction_type", { length: 20 }).notNull(), // 'STORE_SALE' or 'DC_SALE'
  cashierUserId: integer("cashier_user_id").notNull().references(() => users.id),
  customerProfileId: integer("customer_profile_id").references(() => customerProfiles.id),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(), // VND amount
  paymentMethod: varchar("payment_method", { length: 20 }).notNull(),
  transactionDate: timestamp("transaction_date").defaultNow(),
  status: varchar("status", { length: 20 }).notNull().default('completed'), // 'completed', 'refunded', 'voided'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sales Transaction Items table - Sale line items with inventory tracking
export const salesTransactionItems = pgTable("sales_transaction_items", {
  id: serial("id").primaryKey(),
  salesTransactionId: integer("sales_transaction_id").notNull().references(() => salesTransactions.id),
  productId: integer("product_id").notNull().references(() => products.id),
  inventoryId: integer("inventory_id").notNull().references(() => inventory.id), // Specific inventory deducted
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  totalPrice: decimal("total_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  createdAt: timestamp("created_at").defaultNow(),
});

// Sales Transaction Actions table - Audit trail for sales operations
export const salesTransactionActions = pgTable("sales_transaction_actions", {
  id: serial("id").primaryKey(),
  salesTransactionId: integer("sales_transaction_id").notNull().references(() => salesTransactions.id),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  actionData: jsonb("action_data").$type<{ notes?: string, refundAmount?: number, reference?: string }>(),
  performedByUserId: integer("performed_by_user_id").notNull().references(() => users.id),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transfer Requests table - Inter-store inventory transfer requests
export const transferRequests = pgTable("transfer_requests", {
  id: serial("id").primaryKey(),
  transferNumber: varchar("transfer_number", { length: 50 }).notNull().unique(),
  fromStoreId: integer("from_store_id").references(() => stores.id),
  toStoreId: integer("to_store_id").references(() => stores.id),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  priority: varchar("priority", { length: 10 }).notNull().default('normal'),
  notes: text("notes"),
  requestedAt: timestamp("requested_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transfer Request Items table - Items in transfer requests
export const transferRequestItems = pgTable("transfer_request_items", {
  id: serial("id").primaryKey(),
  transferRequestId: integer("transfer_request_id").notNull().references(() => transferRequests.id, { onDelete: 'cascade' }),
  productId: integer("product_id").notNull().references(() => products.id),
  requestedQuantity: integer("requested_quantity").notNull(),
  approvedQuantity: integer("approved_quantity"),
  transferredQuantity: integer("transferred_quantity").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Transfer Actions table - Approval/rejection history
export const transferActions = pgTable("transfer_actions", {
  id: serial("id").primaryKey(),
  transferRequestId: integer("transfer_request_id").notNull().references(() => transferRequests.id, { onDelete: 'cascade' }),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  actionData: jsonb("action_data").$type<{ notes?: string, approvedQuantity?: number, rejectionReason?: string }>(),
  performedByUserId: integer("performed_by_user_id").notNull().references(() => users.id),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transfer History table - Completed transfers audit trail
export const transferHistory = pgTable("transfer_history", {
  id: serial("id").primaryKey(),
  transferRequestId: integer("transfer_request_id").notNull().references(() => transferRequests.id, { onDelete: 'cascade' }),
  fromInventoryId: integer("from_inventory_id").notNull().references(() => inventory.id),
  toInventoryId: integer("to_inventory_id").notNull().references(() => inventory.id),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  transferredAt: timestamp("transferred_at").defaultNow(),
  transferredByUserId: integer("transferred_by_user_id").notNull().references(() => users.id),
  notes: text("notes"),
});

// Define relationships
export const brandsRelations = relations(brands, ({ many }) => ({
  products: many(products),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  inventory: many(inventory),
  purchaseOrders: many(purchaseOrders),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  brand: one(brands, {
    fields: [products.brandId],
    references: [brands.id],
  }),
  inventory: many(inventory),
  orderItems: many(orderItems),
  purchaseOrderItems: many(purchaseOrderItems)
}));


export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
  storeAssignments: many(userStoreAssignments),
}));

export const storesRelations = relations(stores, ({ many }) => ({
  inventory: many(inventory),
  orders: many(orders),
  userAssignments: many(userStoreAssignments),
}));

export const userStoreAssignmentsRelations = relations(userStoreAssignments, ({ one }) => ({
  user: one(users, {
    fields: [userStoreAssignments.userId],
    references: [users.id],
  }),
  store: one(stores, {
    fields: [userStoreAssignments.storeId],
    references: [stores.id],
  }),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  product: one(products, {
    fields: [inventory.productId],
    references: [products.id],
  }),
  store: one(stores, {
    fields: [inventory.storeId],
    references: [stores.id],
  }),
  supplier: one(suppliers, {
    fields: [inventory.supplierId],
    references: [suppliers.id],
  }),
}));

export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  store: one(stores, {
    fields: [orders.storeId],
    references: [stores.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [orders.customerProfileId],
    references: [customerProfiles.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ many, one }) => ({
  items: many(purchaseOrderItems),
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  destinationStore: one(stores, {
    fields: [purchaseOrders.destinationStoreId],
    references: [stores.id],
  }),
  actions: many(purchaseOrderActions),
}));

// Add relations for purchase order actions
export const purchaseOrderActionsRelations = relations(purchaseOrderActions, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderActions.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  performedByUser: one(users, {
    fields: [purchaseOrderActions.performedByUserId],
    references: [users.id],
  }),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  product: one(products, {
    fields: [purchaseOrderItems.productId],
    references: [products.id],
  }),
}));

// Add relations for customer profiles
export const customerProfilesRelations = relations(customerProfiles, ({ many }) => ({
  orders: many(orders),
  salesTransactions: many(salesTransactions),
}));

// Add relations for invoice counters
export const invoiceCountersRelations = relations(invoiceCounters, ({ one }) => ({
  store: one(stores, {
    fields: [invoiceCounters.storeId],
    references: [stores.id],
  }),
}));

// Add relations for sales transactions
export const salesTransactionsRelations = relations(salesTransactions, ({ many, one }) => ({
  items: many(salesTransactionItems),
  actions: many(salesTransactionActions),
  store: one(stores, {
    fields: [salesTransactions.storeId],
    references: [stores.id],
  }),
  cashierUser: one(users, {
    fields: [salesTransactions.cashierUserId],
    references: [users.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [salesTransactions.customerProfileId],
    references: [customerProfiles.id],
  }),
}));

// Add relations for sales transaction items
export const salesTransactionItemsRelations = relations(salesTransactionItems, ({ one }) => ({
  salesTransaction: one(salesTransactions, {
    fields: [salesTransactionItems.salesTransactionId],
    references: [salesTransactions.id],
  }),
  product: one(products, {
    fields: [salesTransactionItems.productId],
    references: [products.id],
  }),
  inventory: one(inventory, {
    fields: [salesTransactionItems.inventoryId],
    references: [inventory.id],
  }),
}));

// Add relations for sales transaction actions
export const salesTransactionActionsRelations = relations(salesTransactionActions, ({ one }) => ({
  salesTransaction: one(salesTransactions, {
    fields: [salesTransactionActions.salesTransactionId],
    references: [salesTransactions.id],
  }),
  performedByUser: one(users, {
    fields: [salesTransactionActions.performedByUserId],
    references: [users.id],
  }),
}));

// Add transfer request relations
export const transferRequestsRelations = relations(transferRequests, ({ many, one }) => ({
  items: many(transferRequestItems),
  actions: many(transferActions),
  history: many(transferHistory),
  fromStore: one(stores, {
    fields: [transferRequests.fromStoreId],
    references: [stores.id],
  }),
  toStore: one(stores, {
    fields: [transferRequests.toStoreId],
    references: [stores.id],
  }),
  requestedByUser: one(users, {
    fields: [transferRequests.requestedByUserId],
    references: [users.id],
  }),
}));

// Add transfer request item relations
export const transferRequestItemsRelations = relations(transferRequestItems, ({ one }) => ({
  transferRequest: one(transferRequests, {
    fields: [transferRequestItems.transferRequestId],
    references: [transferRequests.id],
  }),
  product: one(products, {
    fields: [transferRequestItems.productId],
    references: [products.id],
  }),
}));

// Add transfer action relations
export const transferActionsRelations = relations(transferActions, ({ one }) => ({
  transferRequest: one(transferRequests, {
    fields: [transferActions.transferRequestId],
    references: [transferRequests.id],
  }),
  performedByUser: one(users, {
    fields: [transferActions.performedByUserId],
    references: [users.id],
  }),
}));

// Add transfer history relations
export const transferHistoryRelations = relations(transferHistory, ({ one }) => ({
  transferRequest: one(transferRequests, {
    fields: [transferHistory.transferRequestId],
    references: [transferRequests.id],
  }),
  fromInventory: one(inventory, {
    fields: [transferHistory.fromInventoryId],
    references: [inventory.id],
  }),
  toInventory: one(inventory, {
    fields: [transferHistory.toInventoryId],
    references: [inventory.id],
  }),
  product: one(products, {
    fields: [transferHistory.productId],
    references: [products.id],
  }),
  transferredByUser: one(users, {
    fields: [transferHistory.transferredByUserId],
    references: [users.id],
  }),
}));

// Add regions relations
export const regionsRelations = relations(regions, ({ one, many }) => ({
  managerUser: one(users, {
    fields: [regions.managerUserId],
    references: [users.id],
  }),
  stores: many(stores),
}));

// Export schemas
export const insertBrandSchema = createInsertSchema(brands);
export const selectBrandSchema = createSelectSchema(brands);
export type InsertBrand = typeof brands.$inferInsert;
export type SelectBrand = typeof brands.$inferSelect;

export const insertSupplierSchema = createInsertSchema(suppliers);
export const selectSupplierSchema = createSelectSchema(suppliers);
export type InsertSupplier = typeof suppliers.$inferInsert;
export type SelectSupplier = typeof suppliers.$inferSelect;


export const insertRoleSchema = createInsertSchema(roles);
export const selectRoleSchema = createSelectSchema(roles);
export type InsertRole = typeof roles.$inferInsert;
export type SelectRole = typeof roles.$inferSelect;

export const insertUserSchema = createInsertSchema(users);
export const updateUserSchema = insertUserSchema.partial();
export const selectUserSchema = createSelectSchema(users);
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect & {
  role?: SelectRole | null;
};

export const insertStoreSchema = createInsertSchema(stores);
export const selectStoreSchema = createSelectSchema(stores);
export type InsertStore = typeof stores.$inferInsert;
export type SelectStore = typeof stores.$inferSelect;

export const insertUserStoreAssignmentSchema = createInsertSchema(userStoreAssignments);
export const selectUserStoreAssignmentSchema = createSelectSchema(userStoreAssignments);
export type InsertUserStoreAssignment = typeof userStoreAssignments.$inferInsert;
export type SelectUserStoreAssignment = typeof userStoreAssignments.$inferSelect & {
  user?: SelectUser | null;
  store?: SelectStore | null;
};

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders);
export const selectPurchaseOrderSchema = createSelectSchema(purchaseOrders);
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type SelectPurchaseOrder = typeof purchaseOrders.$inferSelect;

export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItems);
export const selectPurchaseOrderItemSchema = createSelectSchema(purchaseOrderItems);
export type InsertPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;
export type SelectPurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;

export const insertPurchaseOrderActionSchema = createInsertSchema(purchaseOrderActions);
export const selectPurchaseOrderActionSchema = createSelectSchema(purchaseOrderActions);
export type InsertPurchaseOrderAction = typeof purchaseOrderActions.$inferInsert;
export type SelectPurchaseOrderAction = typeof purchaseOrderActions.$inferSelect;

// Add customer profile schemas
export const insertCustomerProfileSchema = createInsertSchema(customerProfiles, {
  photo: z.string().nullable().optional(),
  petBirthday: z.string().nullable().optional()
});
export const selectCustomerProfileSchema = createSelectSchema(customerProfiles);
export type InsertCustomerProfile = typeof customerProfiles.$inferInsert;
export type SelectCustomerProfile = typeof customerProfiles.$inferSelect;

// Add invoice counter schemas
export const insertInvoiceCounterSchema = createInsertSchema(invoiceCounters);
export const selectInvoiceCounterSchema = createSelectSchema(invoiceCounters);
export type InsertInvoiceCounter = typeof invoiceCounters.$inferInsert;
export type SelectInvoiceCounter = typeof invoiceCounters.$inferSelect;

// Add sales transaction schemas
export const insertSalesTransactionSchema = createInsertSchema(salesTransactions);
export const selectSalesTransactionSchema = createSelectSchema(salesTransactions);
export type InsertSalesTransaction = typeof salesTransactions.$inferInsert;
export type SelectSalesTransaction = typeof salesTransactions.$inferSelect;

// Add sales transaction item schemas
export const insertSalesTransactionItemSchema = createInsertSchema(salesTransactionItems);
export const selectSalesTransactionItemSchema = createSelectSchema(salesTransactionItems);
export type InsertSalesTransactionItem = typeof salesTransactionItems.$inferInsert;
export type SelectSalesTransactionItem = typeof salesTransactionItems.$inferSelect;

// Add sales transaction action schemas
export const insertSalesTransactionActionSchema = createInsertSchema(salesTransactionActions);
export const selectSalesTransactionActionSchema = createSelectSchema(salesTransactionActions);
export type InsertSalesTransactionAction = typeof salesTransactionActions.$inferInsert;
export type SelectSalesTransactionAction = typeof salesTransactionActions.$inferSelect;

// Add transfer request schemas
export const insertTransferRequestSchema = createInsertSchema(transferRequests);
export const selectTransferRequestSchema = createSelectSchema(transferRequests);
export type InsertTransferRequest = typeof transferRequests.$inferInsert;
export type SelectTransferRequest = typeof transferRequests.$inferSelect;

// Add transfer request item schemas
export const insertTransferRequestItemSchema = createInsertSchema(transferRequestItems);
export const selectTransferRequestItemSchema = createSelectSchema(transferRequestItems);
export type InsertTransferRequestItem = typeof transferRequestItems.$inferInsert;
export type SelectTransferRequestItem = typeof transferRequestItems.$inferSelect;

// Add transfer action schemas
export const insertTransferActionSchema = createInsertSchema(transferActions);
export const selectTransferActionSchema = createSelectSchema(transferActions);
export type InsertTransferAction = typeof transferActions.$inferInsert;
export type SelectTransferAction = typeof transferActions.$inferSelect;

// Add transfer history schemas
export const insertTransferHistorySchema = createInsertSchema(transferHistory);
export const selectTransferHistorySchema = createSelectSchema(transferHistory);
export type InsertTransferHistory = typeof transferHistory.$inferInsert;
export type SelectTransferHistory = typeof transferHistory.$inferSelect;
