import { pgTable, text, serial, integer, boolean, timestamp, date, varchar, decimal } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { jsonb } from "drizzle-orm/pg-core";

// Role Locations table
export const roleLocations = pgTable("role_locations", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
});

type Permissions = {
  products: { create: boolean; read: boolean; update: boolean; delete: boolean };
  orders: { create: boolean; read: boolean; update: boolean; delete: boolean };
  inventory: { create: boolean; read: boolean; update: boolean; delete: boolean };
  users: { create: boolean; read: boolean; update: boolean; delete: boolean };
  stores: { create: boolean; read: boolean; update: boolean; delete: boolean };
  customerProfiles: { create: boolean; read: boolean; update: boolean; delete: boolean }; // Added customer profiles permissions
};

// Roles table with proper JSONB handling
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  description: text("description"),
  roleLocationId: integer("role_location_id").references(() => roleLocations.id).notNull(),
  permissions: jsonb("permissions").$type<Permissions>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users table with complete schema and validation
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  roleId: integer("role_id").references(() => roles.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// After users table definition, add the schema validation
export const insertUserSchema = z.object({
  username: z.string().min(1, "Username is required").refine(
    val => /^[a-z]+$/.test(val),
    "Username must contain only lowercase letters"
  ),
  password: z.string().min(6, "Password must be at least 6 characters"),
  roleId: z.number().int().positive("Role ID is required"),
});

// Add update user schema that makes all fields optional
export const updateUserSchema = z.object({
  username: z.string()
    .min(1, "Username is required")
    .refine(
      val => /^[a-z]+$/.test(val),
      "Username must contain only lowercase letters"
    )
    .optional(),
  password: z.string()
    .min(6, "Password must be at least 6 characters")
    .optional(),
  roleId: z.number()
    .int()
    .positive("Role ID must be positive")
    .optional(),
});

export const selectUserSchema = createSelectSchema(users);
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect & {
  role?: SelectRole | null;
};

// Stores table with new billPrefix field
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  contactInfo: text("contact_info").notNull(),
  billPrefix: varchar("bill_prefix", { length: 4 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Store schemas
export const insertStoreSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location: z.string().min(1, "Location is required"),
  contactInfo: z.string().min(1, "Contact information is required"),
  billPrefix: z.string().length(4, "Bill prefix must be exactly 4 characters")
    .regex(/^[A-Z0-9]+$/, "Bill prefix must contain only uppercase letters and numbers"),
});

export const updateStoreSchema = insertStoreSchema.partial();
export const selectStoreSchema = createSelectSchema(stores);
export type InsertStore = typeof stores.$inferInsert;
export type SelectStore = typeof stores.$inferSelect;


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

// Bills table for the billing management system
export const bills = pgTable("bills", {
  id: serial("id").primaryKey(),
  billNumber: varchar("bill_number", { length: 20 }).notNull().unique(),
  storeId: integer("store_id").references(() => stores.id).notNull(),
  customerProfileId: integer("customer_profile_id").references(() => customerProfiles.id),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull(),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Bill Items table for individual items in bills
export const billItems = pgTable("bill_items", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").references(() => bills.id).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(),
  // Store product details at time of sale for historical record
  productName: text("product_name").notNull(),
  productDescription: text("product_description"),
  categoryName: text("category_name").notNull(),
  brandName: text("brand_name"),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull(),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
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

export const roleLocationsRelations = relations(roleLocations, ({ many }) => ({
  roles: many(roles),
}));

export const rolesRelations = relations(roles, ({ many, one }) => ({
  users: many(users),
  roleLocation: one(roleLocations, {
    fields: [roles.roleLocationId],
    references: [roleLocations.id],
  }),
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
  bills: many(bills), // Add bills relation
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
  bills: many(bills), // Add bills relation
}));

// Add relations for bills
export const billsRelations = relations(bills, ({ many, one }) => ({
  items: many(billItems),
  store: one(stores, {
    fields: [bills.storeId],
    references: [stores.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [bills.customerProfileId],
    references: [customerProfiles.id],
  }),
}));

// Add relations for bill items
export const billItemsRelations = relations(billItems, ({ one }) => ({
  bill: one(bills, {
    fields: [billItems.billId],
    references: [bills.id],
  }),
  product: one(products, {
    fields: [billItems.productId],
    references: [products.id],
  }),
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

export const insertRoleLocationSchema = createInsertSchema(roleLocations);
export const selectRoleLocationSchema = createSelectSchema(roleLocations);
export type InsertRoleLocation = typeof roleLocations.$inferInsert;
export type SelectRoleLocation = typeof roleLocations.$inferSelect;

export const insertRoleSchema = createInsertSchema(roles);
export const selectRoleSchema = createSelectSchema(roles);
export type InsertRole = typeof roles.$inferInsert;
export type SelectRole = typeof roles.$inferSelect & {
  roleLocation?: SelectRoleLocation | null;
};

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

// Add customer profile schemas
export const insertCustomerProfileSchema = createInsertSchema(customerProfiles);
export const selectCustomerProfileSchema = createSelectSchema(customerProfiles);
export type InsertCustomerProfile = typeof customerProfiles.$inferInsert;
export type SelectCustomerProfile = typeof customerProfiles.$inferSelect;

// Add schemas for bills and bill items
export const insertBillSchema = createInsertSchema(bills);
export const selectBillSchema = createSelectSchema(bills);
export type InsertBill = typeof bills.$inferInsert;
export type SelectBill = typeof bills.$inferSelect;

export const insertBillItemSchema = createInsertSchema(billItems);
export const selectBillItemSchema = createSelectSchema(billItems);
export type InsertBillItem = typeof billItems.$inferInsert;
export type SelectBillItem = typeof billItems.$inferSelect;

// Custom Zod schema for bill creation with items
export const createBillSchema = z.object({
  storeId: z.number().positive("Store ID is required"),
  customerProfileId: z.number().positive("Customer ID is required").optional(),
  items: z.array(z.object({
    productId: z.number().positive("Product ID is required"),
    quantity: z.number().positive("Quantity must be positive"),
    unitPrice: z.number().positive("Unit price must be positive"),
  })).min(1, "At least one item is required"),
});