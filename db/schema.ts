import { pgTable, text, serial, integer, boolean, timestamp, date, varchar, decimal, index, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
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
  parentId: integer("parent_id").references(() => categories.id), // Self-referencing for N-level subcategories
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
  // Price tiers - all optional (nullable) so existing products can stay unset.
  // 'landing' cost of landing the goods, 'b2b' wholesale, 'b2c' retail/consumer.
  landingPrice: decimal("landing_price", { precision: 15, scale: 2 }), // VND amount
  b2bPrice: decimal("b2b_price", { precision: 15, scale: 2 }), // VND amount
  b2cPrice: decimal("b2c_price", { precision: 15, scale: 2 }), // VND amount
  categoryId: integer("category_id").references(() => categories.id).notNull(),
  brandId: integer("brand_id").references(() => brands.id),
  // Preferred/default supplier for the product (optional).
  supplierId: integer("supplier_id").references(() => suppliers.id),
  // Physical attributes - all optional (nullable) so existing products stay valid.
  // Weight is stored in kilograms (decimal, so 350 g is 0.35); length/width/height
  // in centimetres.
  weightKg: decimal("weight_kg", { precision: 10, scale: 3 }),
  lengthCm: decimal("length_cm", { precision: 10, scale: 2 }),
  widthCm: decimal("width_cm", { precision: 10, scale: 2 }),
  heightCm: decimal("height_cm", { precision: 10, scale: 2 }),
  // Product pictures. `imageUrl` is the *featured* picture shown in the product
  // grid and POS; `galleryImages` keeps up to ten extra pictures that are only
  // shown on the product details screen. Both hold short URLs served from
  // /uploads/products (see server/product-images.ts) - never base64 payloads, so
  // the product list response stays small.
  imageUrl: text("image_url"),
  galleryImages: jsonb("gallery_images").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
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
  // AI Agent Note: the receipt cost of one unit *after* the goods receipt's fees are spread
  // across the lines (unitPrice + this line's share of shipping/customs/brokerage). Null
  // until the goods actually arrive - a pending PO has no true cost yet.
  landedCostPerUnit: decimal("landed_cost_per_unit", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Goods Receipts (GRN) table - the physical arrival of a purchase order.
//
// AI Agent Note: these figures (actual delivery date, shipping, customs, brokerage, extra
// fees) are only knowable when the goods land, so they live on their own row and NOT on
// purchase_orders. Keeping the PO's `deliveryDate` as the *expected* date is what makes
// on-time delivery measurable; overwriting it would destroy that comparison and the audit
// trail of who received what. One PO can eventually have several receipts (partial
// deliveries), so this is a table and not a set of columns on the order.
export const goodsReceipts = pgTable("goods_receipts", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "cascade" }).notNull(),
  receiptNumber: varchar("receipt_number", { length: 50 }).notNull().unique(),
  actualDeliveryDate: timestamp("actual_delivery_date").notNull(),
  shippingFee: decimal("shipping_fee", { precision: 15, scale: 2 }).notNull().default("0"), // VND amount
  customsDuty: decimal("customs_duty", { precision: 15, scale: 2 }).notNull().default("0"), // VND amount
  customsTax: decimal("customs_tax", { precision: 15, scale: 2 }).notNull().default("0"), // VND amount
  brokerageFee: decimal("brokerage_fee", { precision: 15, scale: 2 }).notNull().default("0"), // VND amount
  additionalFee: decimal("additional_fee", { precision: 15, scale: 2 }).notNull().default("0"), // VND amount
  // What the "additional fee" was, so a reader of the record knows why money was spent.
  additionalFeeNote: text("additional_fee_note"),
  // Sum of the five fee columns; kept as a column so reports do not have to re-add them.
  totalAdditionalCost: decimal("total_additional_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  receivedByUserId: integer("received_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Goods Receipt Items - which purchase order line a receipt covered, and how many units.
//
// AI Agent Note: a delivery can be short or arrive in several shipments, so a receipt has to
// say *what* turned up, not just that "something" did. Without these rows a partial delivery
// would either lose the shortfall or mark the order fully received. Each row keeps its own
// copy of the money, because the fees of this particular shipment only apply to the units that
// were actually on it - a second, later shipment carries its own (different) fees.
export const goodsReceiptItems = pgTable("goods_receipt_items", {
  id: serial("id").primaryKey(),
  goodsReceiptId: integer("goods_receipt_id").references(() => goodsReceipts.id, { onDelete: "cascade" }).notNull(),
  purchaseOrderItemId: integer("purchase_order_item_id").references(() => purchaseOrderItems.id, { onDelete: "cascade" }).notNull(),
  quantity: integer("quantity").notNull(), // units received on this shipment
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  // This line's share of the receipt's fees, so the receipt can be audited line by line.
  allocatedCost: decimal("allocated_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  // What one of *these* units cost: unitPrice + allocatedCost / quantity.
  landedCostPerUnit: decimal("landed_cost_per_unit", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Purchase Order Actions table for tracking order processes
export const purchaseOrderActions = pgTable("purchase_order_actions", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(), // 'cancel', 'print', 'invoice_received', 'payment_sent', 'goods_receipt'
  actionData: jsonb("action_data").$type<{ notes?: string, quantity?: number, reference?: string, partial?: boolean }>(),
  performedByUserId: integer("performed_by_user_id").references(() => users.id).notNull(),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Customer Profiles table
//
// A customer profile describes the *account*, not a pet. `customerType` says whether the
// account is a business (`B2B`) or an end consumer (`B2C`) - it is rendered as a dropdown
// and validated against CUSTOMER_TYPES. `mobileNumber` holds the mobile number and is the
// natural key used to look a customer up at the till; `landLineNumber` is the optional
// fixed line, which is why it is free text rather than a date.
export const customerProfiles = pgTable("customer_profiles", {
  id: serial("id").primaryKey(),
  mobileNumber: varchar("mobile_number", { length: 20 }).notNull().unique(), // mobile number
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  address: text("address").notNull(),
  photo: text("photo"),
  landLineNumber: varchar("land_line_number", { length: 20 }),
  customerType: varchar("customer_type", { length: 10 }).notNull(), // 'B2B' or 'B2C'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // Keep the free-text column inside the dropdown's value domain, so a bad client write
  // cannot store something the UI can never render.
  customerTypeCheck: check(
    "customer_profiles_customer_type_check",
    sql`${table.customerType} IN ('B2B', 'B2C')`,
  ),
}));

/** Allowed `customerProfiles.customerType` values (the dropdown choices). */
export const CUSTOMER_TYPES = ["B2B", "B2C"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

// Sales Orders table - the customer-facing counterpart of purchaseOrders.
//
// AI Agent Note: the customer details are *copied onto the order* instead of being read
// from customer_profiles at print time. A sales order is a document the customer signed:
// renaming the company or moving the delivery address later must not silently rewrite a
// document that was already issued. `customerProfileId` stays as the link for reporting.
export const salesOrders = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("order_number", { length: 50 }).notNull().unique(), // SO-YYYYMMDD-NNNN
  customerProfileId: integer("customer_profile_id").references(() => customerProfiles.id),
  customerName: text("customer_name").notNull(),
  companyName: text("company_name"),
  contactPerson: text("contact_person"),
  phone: varchar("phone", { length: 20 }),
  deliveryAddress: text("delivery_address"),
  orderDate: timestamp("order_date").notNull().defaultNow(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull().default("0"), // VND amount
  specialInstructions: text("special_instructions"),
  // 'open' | 'partially_delivered' | 'delivered' | 'cancelled' - derived from the lines by
  // recalculateSalesOrderStatus (server/sales-orders.ts), never set by hand except on cancel.
  status: varchar("status", { length: 24 }).notNull().default('open'),
  preparedByUserId: integer("prepared_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sales Order Items table.
//
// productCode/description are snapshots of products.sku / products.name for the same reason
// as the customer details above: the printed order must keep showing what was ordered even if
// the catalogue entry is renamed or its SKU is corrected.
export const salesOrderItems = pgTable("sales_order_items", {
  id: serial("id").primaryKey(),
  salesOrderId: integer("sales_order_id").references(() => salesOrders.id, { onDelete: "cascade" }).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  productCode: varchar("product_code", { length: 64 }).notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  totalPrice: decimal("total_price", { precision: 15, scale: 2 }).notNull(), // VND amount
  // Units already covered by delivery notes. Incremented by POST /api/delivery-notes.
  deliveredQuantity: integer("delivered_quantity").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Delivery Notes (outbound counterpart of the goods receipt).
//
// A short delivery produces one note per shipment; the note carries its own copy of the
// customer block so it can be reprinted exactly as it was signed.
export const deliveryNotes = pgTable("delivery_notes", {
  id: serial("id").primaryKey(),
  deliveryNoteNumber: varchar("delivery_note_number", { length: 50 }).notNull().unique(), // DN-YYYYMMDD-NNNN
  salesOrderId: integer("sales_order_id").references(() => salesOrders.id).notNull(),
  deliveryDate: timestamp("delivery_date").notNull().defaultNow(),
  // Customer block snapshotted from the sales order at the moment of delivery.
  customerName: text("customer_name").notNull(),
  companyName: text("company_name"),
  contactPerson: text("contact_person"),
  phone: varchar("phone", { length: 20 }),
  deliveryAddress: text("delivery_address"),
  deliveredByUserId: integer("delivered_by_user_id").references(() => users.id).notNull(),
  // "Goods received in good condition." ticked by the customer on the printed note.
  customerConfirmed: boolean("customer_confirmed").notNull().default(false),
  remarks: text("remarks"),
  status: varchar("status", { length: 20 }).notNull().default('issued'), // 'issued' | 'cancelled'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Delivery Note Items - one row per order line that travelled on this note.
//
// AI Agent Note: orderedQuantity is a snapshot, not a join to salesOrderItems.quantity, so a
// reprinted note keeps saying "Ordered 10 / Delivered 6" even after the rest of the order has
// been delivered and the order line's delivered_quantity has moved on.
export const deliveryNoteItems = pgTable("delivery_note_items", {
  id: serial("id").primaryKey(),
  deliveryNoteId: integer("delivery_note_id").references(() => deliveryNotes.id, { onDelete: "cascade" }).notNull(),
  salesOrderItemId: integer("sales_order_item_id").references(() => salesOrderItems.id, { onDelete: "cascade" }).notNull(),
  productCode: varchar("product_code", { length: 64 }).notNull(),
  description: text("description").notNull(),
  orderedQuantity: integer("ordered_quantity").notNull(),
  deliveredQuantity: integer("delivered_quantity").notNull(),
  remarks: text("remarks"),
  createdAt: timestamp("created_at").defaultNow(),
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
  products: many(products),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'parent',
  }),
  subcategories: many(categories, {
    relationName: 'subcategories',
  }),
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
  supplier: one(suppliers, {
    fields: [products.supplierId],
    references: [suppliers.id],
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
  goodsReceipts: many(goodsReceipts),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ many, one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceipts.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  receivedByUser: one(users, {
    fields: [goodsReceipts.receivedByUserId],
    references: [users.id],
  }),
  items: many(goodsReceiptItems),
}));

export const goodsReceiptItemsRelations = relations(goodsReceiptItems, ({ one }) => ({
  receipt: one(goodsReceipts, {
    fields: [goodsReceiptItems.goodsReceiptId],
    references: [goodsReceipts.id],
  }),
  purchaseOrderItem: one(purchaseOrderItems, {
    fields: [goodsReceiptItems.purchaseOrderItemId],
    references: [purchaseOrderItems.id],
  }),
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

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ many, one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  product: one(products, {
    fields: [purchaseOrderItems.productId],
    references: [products.id],
  }),
  goodsReceiptItems: many(goodsReceiptItems),
}));

// Add relations for customer profiles
export const customerProfilesRelations = relations(customerProfiles, ({ many }) => ({
  orders: many(orders),
  salesTransactions: many(salesTransactions),
  salesOrders: many(salesOrders),
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

// Add sales order relations
export const salesOrdersRelations = relations(salesOrders, ({ many, one }) => ({
  items: many(salesOrderItems),
  deliveryNotes: many(deliveryNotes),
  customerProfile: one(customerProfiles, {
    fields: [salesOrders.customerProfileId],
    references: [customerProfiles.id],
  }),
  preparedByUser: one(users, {
    fields: [salesOrders.preparedByUserId],
    references: [users.id],
  }),
}));

// Add sales order item relations
export const salesOrderItemsRelations = relations(salesOrderItems, ({ one, many }) => ({
  salesOrder: one(salesOrders, {
    fields: [salesOrderItems.salesOrderId],
    references: [salesOrders.id],
  }),
  product: one(products, {
    fields: [salesOrderItems.productId],
    references: [products.id],
  }),
  deliveryNoteItems: many(deliveryNoteItems),
}));

// Add delivery note relations
export const deliveryNotesRelations = relations(deliveryNotes, ({ many, one }) => ({
  items: many(deliveryNoteItems),
  salesOrder: one(salesOrders, {
    fields: [deliveryNotes.salesOrderId],
    references: [salesOrders.id],
  }),
  deliveredByUser: one(users, {
    fields: [deliveryNotes.deliveredByUserId],
    references: [users.id],
  }),
}));

// Add delivery note item relations
export const deliveryNoteItemsRelations = relations(deliveryNoteItems, ({ one }) => ({
  deliveryNote: one(deliveryNotes, {
    fields: [deliveryNoteItems.deliveryNoteId],
    references: [deliveryNotes.id],
  }),
  salesOrderItem: one(salesOrderItems, {
    fields: [deliveryNoteItems.salesOrderItemId],
    references: [salesOrderItems.id],
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
//
// The routes read every field straight off `result.data`, so the required columns are declared
// here as real validators (rather than relying on the drizzle-derived optionality).
export const insertCustomerProfileSchema = createInsertSchema(customerProfiles, {
  mobileNumber: z.string().min(1, "Mobile number is required").max(20, "Mobile number is too long"),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  address: z.string().min(1, "Address is required"),
  photo: z.string().nullable().optional(),
  landLineNumber: z.string().max(20, "Land line number is too long").nullable().optional(),
  customerType: z.enum(CUSTOMER_TYPES)
});
export const selectCustomerProfileSchema = createSelectSchema(customerProfiles);
export type InsertCustomerProfile = typeof customerProfiles.$inferInsert;
export type SelectCustomerProfile = typeof customerProfiles.$inferSelect;

// Add sales order schemas
export const insertSalesOrderSchema = createInsertSchema(salesOrders);
export const selectSalesOrderSchema = createSelectSchema(salesOrders);
export type InsertSalesOrder = typeof salesOrders.$inferInsert;
export type SelectSalesOrder = typeof salesOrders.$inferSelect;

export const insertSalesOrderItemSchema = createInsertSchema(salesOrderItems);
export const selectSalesOrderItemSchema = createSelectSchema(salesOrderItems);
export type InsertSalesOrderItem = typeof salesOrderItems.$inferInsert;
export type SelectSalesOrderItem = typeof salesOrderItems.$inferSelect;

// Add delivery note schemas
export const insertDeliveryNoteSchema = createInsertSchema(deliveryNotes);
export const selectDeliveryNoteSchema = createSelectSchema(deliveryNotes);
export type InsertDeliveryNote = typeof deliveryNotes.$inferInsert;
export type SelectDeliveryNote = typeof deliveryNotes.$inferSelect;

export const insertDeliveryNoteItemSchema = createInsertSchema(deliveryNoteItems);
export const selectDeliveryNoteItemSchema = createSelectSchema(deliveryNoteItems);
export type InsertDeliveryNoteItem = typeof deliveryNoteItems.$inferInsert;
export type SelectDeliveryNoteItem = typeof deliveryNoteItems.$inferSelect;

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

// Session store - see server/session-store.ts.
//
// AI Agent Note: sessions live in the database so a restart/hot reload does not log
// everybody out and so several app instances can share one session. Column names are
// read by DrizzleSessionStore; do not rename without updating it.
export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIdx: index("user_sessions_expire_idx").on(table.expire),
}));

/**
 * Append-only ledger of every stock change.
 *
 * AI Agent Note: `inventory.quantity` is a mutable running total - it says what is on the
 * shelf, never how it got there. A wrong quantity therefore cannot be reconstructed or
 * audited. This table records the cause of every change; `inventory.quantity` stays the
 * cached total and `npm run stock:reconcile` proves the two agree.
 *
 * Deliberately no foreign keys: this is history. Deleting an inventory row (or the product
 * behind it) must not erase the record that stock once moved, and a cascade would do exactly
 * that. productId/storeId are denormalised for the same reason.
 */
export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  inventoryId: integer("inventory_id").notNull(),
  productId: integer("product_id"),
  storeId: integer("store_id"),
  // Signed change applied to the row: negative leaves the shelf, positive arrives on it.
  delta: integer("delta").notNull(),
  // Cached quantity of `inventory.quantity` immediately after this change, when known.
  quantityAfter: integer("quantity_after"),
  // 'sale' | 'refund' | 'cancel' | 'transfer_in' | 'transfer_out' | 'po_receipt' | 'adjustment'
  reason: varchar("reason", { length: 24 }).notNull(),
  // The document that caused it: ('sales_transaction', 42), ('purchase_order', 7), ...
  refType: varchar("ref_type", { length: 40 }),
  refId: integer("ref_id"),
  // Free-text justification for manual changes ("damaged in transit", stock-take note).
  // The `reason` column is a fixed vocabulary, so the human explanation goes here.
  note: text("note"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  inventoryIdx: index("stock_movements_inventory_idx").on(table.inventoryId, table.createdAt),
  reasonIdx: index("stock_movements_reason_idx").on(table.reason),
}));
