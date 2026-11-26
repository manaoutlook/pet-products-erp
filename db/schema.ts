import { pgTable, text, serial, integer, boolean, timestamp, date, varchar, decimal, index, check, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { jsonb } from "drizzle-orm/pg-core";
import { normalizePhoneNumber, MOBILE_NUMBER_PATTERN } from "../shared/phone";
import { normalizeTaxCode, TAX_CODE_PATTERN } from "../shared/tax-code";


type Permissions = {
  products: { create: boolean; read: boolean; update: boolean; delete: boolean };
  orders: { create: boolean; read: boolean; update: boolean; delete: boolean };
  // The VAT Margin Calculator is its own module: the profit split is partner-only information,
  // so it must not be implied by sales-order access.
  vatMargin: { create: boolean; read: boolean; update: boolean; delete: boolean };
  inventory: { create: boolean; read: boolean; update: boolean; delete: boolean };
  users: { create: boolean; read: boolean; update: boolean; delete: boolean };
  stores: { create: boolean; read: boolean; update: boolean; delete: boolean };
  masterData: { create: boolean; read: boolean; update: boolean; delete: boolean };
  // The VAT Companies screen holds the legal entities (and their invoice sequences) that issue
  // VAT invoices. It is master data, but a role may be given suppliers/brands without it.
  vatCompanies: { create: boolean; read: boolean; update: boolean; delete: boolean };
  // The shop's own letterhead (name, addresses, tax ID). It is read by the band at the top of
  // every screen, but editing it is a separate grant: a store manager may run the catalogue
  // without being able to change what every printed document says the company is.
  companyProfile: { create: boolean; read: boolean; update: boolean; delete: boolean };
  pos: { create: boolean; read: boolean; update: boolean; delete: boolean };
  receipts: { create: boolean; read: boolean; update: boolean; delete: boolean };
  finance: { create: boolean; read: boolean; update: boolean; delete: boolean };
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
  // The explicit `AnyPgColumn` return type breaks the circular type inference on this
  // self-reference; without it `categories` falls back to `any` and the whole schema's
  // relation types collapse (which showed up as dozens of bogus errors in server/routes.ts).
  parentId: integer("parent_id").references((): AnyPgColumn => categories.id), // Self-referencing for N-level subcategories
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
  // Denormalised copy of products.supplier_id. Always derived from the product; the
  // API never accepts it from a client (see server/routes.ts and inventory-import.ts).
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
  // How the supplier is (or will be) paid. The order's "Supplier purchases" expense carries the
  // same method, so a bill paid by bank transfer lands in the bank line of "money on hand" instead
  // of the till. Defaulted to CASH so orders created before the column existed keep their old
  // meaning.
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("CASH"),
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
  // A business account is a company plus the person we deal with; a walk-in consumer leaves the
  // company empty and the contact person is whoever is at the counter. The sales orders copy both
  // onto the printed paperwork (`sales_orders.company_name` / `.contact_person`).
  companyName: text("company_name"),
  contactPerson: text("contact_person").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  address: text("address").notNull(),
  photo: text("photo"),
  landLineNumber: varchar("land_line_number", { length: 20 }),
  // A business's tax code (mã số thuế) is what a VAT invoice must show against the buyer.
  // Kept on the profile so the POS can fill the buyer block from the customer instead of the
  // cashier re-typing it - the sale still snapshots the value, so editing this later never
  // rewrites an invoice that was already issued. Empty for a consumer who has none.
  taxId: varchar("tax_id", { length: 50 }).notNull().default(""),
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
  // The buyer's tax code, copied from the customer profile (or typed) when the order is
  // raised. A VAT invoice must show it against the buyer, and it is a snapshot for the same
  // reason as every other customer field: editing the profile cannot rewrite an issued invoice.
  customerTaxId: varchar("customer_tax_id", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  deliveryAddress: text("delivery_address"),
  // Which location the goods leave from - the inventory row its delivery notes are taken off.
  //
  // AI Agent Note: this is the sales-order counterpart of `purchase_orders.destination_store_id`
  // and it uses the same convention: NULL = the Distribution Centre (`inventory.store_id IS NULL`,
  // `inventory_type = 'DC'`), a value = that store's own row. Without it the order had no way to
  // say which shelf the units came off, so its stock could never move (see
  // server/sales-order-stock.ts). Saving the order only CHECKS that the location can cover it;
  // the units leave the ledger when a delivery note is issued, because that is the document that
  // says what actually left the warehouse (and it supports partial deliveries). Each delivery
  // note copies this value onto `delivery_notes.store_id`.
  storeId: integer("store_id").references(() => stores.id),
  // Which licensed company (CI / HI) issues this order's paperwork. NULL = no VAT.
  //
  // AI Agent Note: the company name / tax code / address are copied onto the order at save
  // time (`shared/vat-company.ts`) instead of being read from `vat_companies` at print time.
  // A sales order, its delivery notes and its invoice are documents that were handed to the
  // customer: correcting the company's address later must not silently rewrite them. The
  // `vatCompanyId` stays as the link for reporting and for the delivery note snapshot.
  vatCompanyId: integer("vat_company_id").references(() => vatCompanies.id),
  vatCompanyCode: varchar("vat_company_code", { length: 10 }),
  vatCompanyName: varchar("vat_company_name", { length: 200 }),
  vatCompanyTaxId: varchar("vat_company_tax_id", { length: 50 }),
  vatCompanyAddress: text("vat_company_address"),
  // The rate charged by the company above, copied onto the order when it is saved (fraction;
  // 0.0800 = 8%). The VAT invoice prints VAT at THIS stored rate, so changing the company's
  // rate today cannot alter the invoice of an order raised last month.
  //
  // `0` means the order carries no VAT company at all. The default of 10% exists for rows
  // written before the column was added: those orders were invoiced at the standard rate, and a
  // reprint has to keep producing the same document.
  vatRate: decimal("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.1000"),
  // The VAT invoice issued for this order, if any. The number comes from the selected
  // company's own sequence (CI-.../HI-...) and is written once: a reprint is the same document,
  // and a correction is a new order with a new number. NULL = no VAT invoice issued yet.
  vatInvoiceNumber: varchar("vat_invoice_number", { length: 50 }).unique(),
  vatInvoiceIssuedAt: timestamp("vat_invoice_issued_at"),
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
  // Snapshot of `sales_orders.store_id` at the moment the note was issued: the location the
  // units were taken off. NULL = the Distribution Centre.
  //
  // AI Agent Note: this is also the inventory row the note deducts (see
  // server/sales-order-stock.ts). It is copied, not joined, for the same reason as every other
  // snapshot on this document - moving the order to another warehouse later must not rewrite
  // where a signed note says the goods came from.
  storeId: integer("store_id").references(() => stores.id),
  // The VAT company block, copied from the order when the note is issued. A reprint must
  // keep the letterhead the customer signed, even if the order is later edited or the
  // company's details are corrected. NULL = the order had no VAT company.
  vatCompanyId: integer("vat_company_id").references(() => vatCompanies.id),
  vatCompanyCode: varchar("vat_company_code", { length: 10 }),
  vatCompanyName: varchar("vat_company_name", { length: 200 }),
  vatCompanyTaxId: varchar("vat_company_tax_id", { length: 50 }),
  vatCompanyAddress: text("vat_company_address"),
  deliveredByUserId: integer("delivered_by_user_id").references(() => users.id).notNull(),
  // "Goods received in good condition." ticked by the customer on the printed note.
  // Uploading the signed document (POST /api/delivery-notes/:id/signed-document) ticks it,
  // so a reprint matches the sheet the customer actually signed.
  customerConfirmed: boolean("customer_confirmed").notNull().default(false),
  // Proof of delivery: the picture of the signed note, uploaded once the customer has signed.
  // A note without one is still "Awaiting signature"; with one it is "Signed/Completed".
  // The bytes live in uploads/delivery-notes/, only the short URL is stored (see
  // server/delivery-note-documents.ts).
  signedDocumentUrl: text("signed_document_url"),
  signedDocumentUploadedAt: timestamp("signed_document_uploaded_at"),
  signedDocumentUploadedByUserId: integer("signed_document_uploaded_by_user_id").references(
    () => users.id
  ),
  remarks: text("remarks"),
  status: varchar("status", { length: 20 }).notNull().default('issued'), // 'issued' | 'cancelled'
  // Cancelling a note never deletes anything: the goods issue it recorded is stamped cancelled,
  // its units are put back on the shelf by a RETURN stock movement, and the operator + reason
  // are kept for the audit trail (same shape as `invoices`).
  cancelledAt: timestamp("cancelled_at"),
  cancelledByUserId: integer("cancelled_by_user_id").references(() => users.id),
  cancelReason: text("cancel_reason"),
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

// VAT Companies table - the legal entities a VAT invoice may be issued under
//
// AI Agent Note: "HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH" is a household business and is NOT
// allowed to issue a VAT invoice. When a customer asks for one, the sale is invoiced
// under one of the two licensed companies below instead - the company name, tax code and
// address printed on the invoice are that row's, never the household business letterhead.
// Each company owns its own invoice number sequence (`CI-...` / `HI-...`), so the two
// books of VAT invoices cannot collide. A non-VAT invoice (retail receipt) keeps using the
// store sequence and prints the Company Profile letterhead.
export const vatCompanies = pgTable("vat_companies", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(), // 'CI' = Conqueror International, 'HI' = Hasim International
  name: varchar("name", { length: 200 }).notNull(),
  taxId: varchar("tax_id", { length: 50 }).notNull().default(""),
  address: text("address").notNull().default(""),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 200 }),
  bankAccount: text("bank_account"),
  // The VAT rate this company charges on EVERY invoice it issues, as a fraction
  // (0.1000 = 10%) - the same unit as `sales_transactions.vat_rate`, not a percentage.
  // The VAT Companies screen edits it as a percentage and converts with
  // `percentToRate` / `rateToPercent` (shared/tax.ts).
  //
  // AI Agent Note: this is the one place the rate is configured. A till invoice copies it onto
  // the sale, and a sales order copies it onto the order (`sales_orders.vat_rate`) when the
  // order is saved - so correcting the rate here can never rewrite a document already issued.
  vatRate: decimal("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.1000"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invoice Counters table - Store-specific invoice numbering
export const invoiceCounters = pgTable("invoice_counters", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => stores.id),
  // 'STORE' | 'DC' (per store) | 'VAT_COMPANY' (one independent sequence per VAT company)
  counterType: varchar("counter_type", { length: 20 }).notNull(),
  // Only set when counterType = 'VAT_COMPANY'. A VAT company's sequence is global (not per
  // store) because the invoice is issued by the company, not by the shop that rang it up.
  vatCompanyId: integer("vat_company_id").references(() => vatCompanies.id),
  currentNumber: integer("current_number").notNull().default(0),
  prefix: varchar("prefix", { length: 20 }).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow(),
}, (table) => ({
  // AI Agent Note: one row per VAT company, enforced by the database. Postgres treats
  // NULLs as distinct, so this index constrains only the VAT_COMPANY rows (where
  // vat_company_id is always set) and leaves the existing STORE/DC rows untouched.
  // Without it two simultaneous sales could each insert a CI counter row and hand out the
  // same invoice number from two sequences.
  vatCompanySequence: uniqueIndex("invoice_counters_vat_company_unique").on(
    table.counterType,
    table.vatCompanyId
  ),
}));

// Sales Transactions table - POS sales records
//
// AI Agent Note - the money on a sale is computed ONCE, here, and never again:
//   subtotal  = sum of the line totals (catalogue prices are VAT-EXCLUSIVE)
//   vatAmount = subtotal x vatRate   (only when the sale was invoiced with VAT)
//   totalAmount = subtotal + vatAmount
// The till, the stored row and every reprint read these three columns. Nothing is allowed
// to recompute a tax rate from a total (the old `total / 1.1` reprint path is why 110,000
// at the till became 90,909.09 + 9,090.91 + 100,000 on the receipt). If a sale is not
// invoiced with VAT, vatRate and vatAmount are 0 and totalAmount equals subtotal.
//
// `vatCompanyId` is the legal entity that issued the VAT invoice (see `vatCompanies`).
// It is NULL for a non-VAT retail sale, which is the normal case for this household
// business. `archivedDocumentUrl` is the immutable copy of the PDF that was actually
// issued; it is written once and then re-served forever.
export const salesTransactions = pgTable("sales_transactions", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  storeId: integer("store_id").references(() => stores.id),
  transactionType: varchar("transaction_type", { length: 20 }).notNull(), // 'STORE_SALE' or 'DC_SALE'
  cashierUserId: integer("cashier_user_id").notNull().references(() => users.id),
  customerProfileId: integer("customer_profile_id").references(() => customerProfiles.id),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull().default("0"), // VAT-exclusive
  vatRate: decimal("vat_rate", { precision: 5, scale: 4 }).notNull().default("0"), // 0.1000 = 10%
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(), // subtotal + vatAmount
  printedWithVat: boolean("printed_with_vat").notNull().default(false),
  vatCompanyId: integer("vat_company_id").references(() => vatCompanies.id),
  // Buyer block, snapshotted at sale time (see `sales_transaction_items.description` for the
  // same reason). A VAT invoice is invalid without a buyer, and editing or deleting a customer
  // profile tomorrow must not change an invoice that was already issued.
  buyerName: text("buyer_name").notNull().default(""),
  buyerCompanyName: varchar("buyer_company_name", { length: 200 }),
  buyerTaxId: varchar("buyer_tax_id", { length: 50 }),
  buyerAddress: text("buyer_address"),
  buyerPhone: varchar("buyer_phone", { length: 50 }),
  buyerEmail: varchar("buyer_email", { length: 200 }),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull(),
  transactionDate: timestamp("transaction_date").defaultNow(),
  status: varchar("status", { length: 20 }).notNull().default('completed'), // 'completed', 'refunded', 'voided'
  // The issued PDF/Document copy. Written once (see server/invoice-documents.ts); a reprint
  // downloads this file instead of re-rendering, so the paper cannot change later.
  archivedDocumentUrl: text("archived_document_url"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sales Transaction Items table - Sale line items with inventory tracking
//
// AI Agent Note - `productCode` and `description` are SNAPSHOTS taken when the sale is
// written, exactly like `sales_order_items` does. `productId` still points at the product
// for reporting, but an invoice is a legal document: if the product is renamed or its SKU
// changes tomorrow, a reprint of this invoice must still show the name and code that were
// sold. Never render an invoice line from the joined `products` row.
export const salesTransactionItems = pgTable("sales_transaction_items", {
  id: serial("id").primaryKey(),
  salesTransactionId: integer("sales_transaction_id").notNull().references(() => salesTransactions.id),
  productId: integer("product_id").notNull().references(() => products.id),
  inventoryId: integer("inventory_id").notNull().references(() => inventory.id), // Specific inventory deducted
  productCode: varchar("product_code", { length: 64 }).notNull().default(""), // snapshot of products.sku
  description: text("description").notNull().default(""), // snapshot of products.name
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

// Invoices table - the receivables register (one invoice per sale / sales order)
//
// AI Agent Note - why this table exists at all, and what it is NOT:
//
// `sales_transactions` is the record of a counter sale; `sales_orders` is the record of an
// order. Neither has room for the one thing a credit sale needs: how much of the document has
// been PAID so far. This table is the AR (accounts receivable) side of an issued document:
//
//   - one row per document (`source` = POS_SALE | SALES_ORDER). The unique indexes make a
//     second invoice for the same sale/order impossible;
//   - `total_amount` / `vat_amount` / `subtotal` / `vat_rate` are a SNAPSHOT copied from the
//     source document at registration time. They are never recomputed and never updated -
//     the rule "the money is computed once" (shared/tax.ts) still holds. Partial payments only
//     move `amount_paid` / `balance_due`, never the invoice value;
//   - `amount_paid` and `balance_due` are a cache of the sum of `invoice_payments` rows. They
//     are written in the same transaction that inserts a payment, under a row lock
//     (`SELECT ... FOR UPDATE`, see server/payments.ts). Recompute from the payments table if
//     they ever disagree;
//   - status is the DB truth: 'issued' | 'partially_paid' | 'paid' | 'cancelled'. 'overdue' is
//     DERIVED at read time from `due_date` (see shared/invoice-payment.ts) because a row cannot
//     become overdue without someone touching it.
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  // 'VAT' (a licensed company's tax invoice) | 'RETAIL' (the shop's own receipt document)
  kind: varchar("kind", { length: 10 }).notNull(),
  // 'POS_SALE' | 'SALES_ORDER'
  source: varchar("source", { length: 20 }).notNull(),
  salesTransactionId: integer("sales_transaction_id").references(() => salesTransactions.id),
  salesOrderId: integer("sales_order_id").references(() => salesOrders.id),
  vatCompanyId: integer("vat_company_id").references(() => vatCompanies.id),
  customerProfileId: integer("customer_profile_id").references(() => customerProfiles.id),
  // Buyer name copied for the receivables list, so the report does not need a join per row.
  buyerName: text("buyer_name").notNull().default(""),
  storeId: integer("store_id").references(() => stores.id),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  // When the balance becomes past due. NULL = no credit term (the invoice is due on issue).
  dueDate: date("due_date"),
  currency: varchar("currency", { length: 3 }).notNull().default("VND"),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 15, scale: 2 }).notNull().default("0"),
  balanceDue: decimal("balance_due", { precision: 15, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("issued"),
  statusUpdatedAt: timestamp("status_updated_at").defaultNow(),
  // Cancelling an invoice never deletes anything: the document is stamped, the reason and the
  // user are kept, and its recorded payments stay visible (they must be refunded separately).
  cancelledAt: timestamp("cancelled_at"),
  cancelledByUserId: integer("cancelled_by_user_id").references(() => users.id),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // One invoice per source document. Postgres treats NULLs as distinct, so the POS index only
  // constrains POS_SALE rows and the order index only SALES_ORDER rows.
  salesTransactionUnique: uniqueIndex("invoices_sales_transaction_unique").on(
    table.salesTransactionId
  ),
  salesOrderUnique: uniqueIndex("invoices_sales_order_unique").on(table.salesOrderId),
  sourceIndex: index("invoices_source_status_idx").on(table.source, table.status),
  issuedAtIndex: index("invoices_issued_at_idx").on(table.issuedAt),
  dueDateIndex: index("invoices_due_date_idx").on(table.dueDate),
  amountsNonNegative: check(
    "invoices_amounts_non_negative",
    sql`${table.totalAmount} >= 0 AND ${table.amountPaid} >= 0 AND ${table.balanceDue} >= 0`
  ),
  sourceConsistency: check(
    "invoices_source_consistency",
    sql`(${table.source} = 'POS_SALE' AND ${table.salesTransactionId} IS NOT NULL AND ${table.salesOrderId} IS NULL)
      OR (${table.source} = 'SALES_ORDER' AND ${table.salesOrderId} IS NOT NULL AND ${table.salesTransactionId} IS NULL)`
  ),
}));

// Invoice Payments table - one row = one payment receipt against an invoice
//
// AI Agent Note: a payment is a document of its own (it gets its own `RCPT-YYYYMMDD-NNNN`
// number, see server/receipt-counter.ts) because a customer who pays in three instalments
// needs three pieces of paper. Nothing here may touch the invoice's `total_amount` - the debt
// shrinks, the document value does not.
export const invoicePayments = pgTable("invoice_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  receiptNumber: varchar("receipt_number", { length: 50 }).notNull().unique(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull(),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
  // Bank transfer reference / cheque number / anything the customer will quote back.
  reference: varchar("reference", { length: 100 }),
  notes: text("notes"),
  receivedByUserId: integer("received_by_user_id").notNull().references(() => users.id),
  storeId: integer("store_id").references(() => stores.id),
  // A receipt is never edited. A wrong one is voided (reason + who + when) and the invoice
  // balance is recomputed; the original row stays for the audit trail.
  voidedAt: timestamp("voided_at"),
  voidedByUserId: integer("voided_by_user_id").references(() => users.id),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  invoiceIndex: index("invoice_payments_invoice_idx").on(table.invoiceId),
  paidAtIndex: index("invoice_payments_paid_at_idx").on(table.paidAt),
  amountPositive: check("invoice_payments_amount_positive", sql`${table.amount} > 0`),
}));

// Finance Partners - the people who put money into the company (capital or a temporary loan).
//
// AI Agent Note: a partner is a NAMED counterparty, not a free-text string, because a
// withdrawal is checked against what that same partner has deposited: see
// `shared/finance.ts::validatePartnerWithdrawal`. The balance itself is derived from
// `finance_entries` (posted deposits - posted withdrawals) and never cached here, so voiding an
// entry corrects the balance without a second write.
export const financePartners = pgTable("finance_partners", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Finance Entries - the manual money book (expenses, other income, partner capital).
//
// AI Agent Note - what is here and what is NOT:
//
//  - Customer receipts are NOT copied in. `invoice_payments` stays the single source of truth for
//    money received against an invoice; the financial report adds that stream to these rows.
//  - `direction` is stored next to `entry_type` and constrained by the database:
//      income / partner_deposit          -> credit (money in)
//      expense / partner_withdrawal      -> debit  (money out)
//  - Nothing is edited or deleted after posting. A wrong row is VOIDED with who/when/why
//    (`status = 'voided'`), exactly like a payment receipt, and drops out of the report totals.
//  - `entry_number` (`FIN-YYYYMMDD-NNNN`) is allocated inside the insert transaction from the
//    shared `invoice_counters` table (`counter_type = 'FINANCE'`), so a rolled-back entry cannot
//    burn a number.
export const financeEntries = pgTable("finance_entries", {
  id: serial("id").primaryKey(),
  entryNumber: varchar("entry_number", { length: 50 }).notNull().unique(),
  // 'income' | 'expense' | 'partner_deposit' | 'partner_withdrawal'
  entryType: varchar("entry_type", { length: 24 }).notNull(),
  // 'debit' | 'credit' - derived from entryType, stored so the ledger and the report agree.
  direction: varchar("direction", { length: 6 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(), // VND
  entryDate: date("entry_date").notNull(),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("CASH"),
  reference: varchar("reference", { length: 100 }),
  notes: text("notes"),
  // Set for partner deposits/withdrawals only. 'capital' = equity, 'loan' = temporary top-up.
  partnerId: integer("partner_id").references(() => financePartners.id),
  fundingKind: varchar("funding_kind", { length: 10 }),
  // 'posted' | 'voided'. A voided row stays in the book and is excluded from every total.
  status: varchar("status", { length: 10 }).notNull().default("posted"),
  voidedAt: timestamp("voided_at"),
  voidedByUserId: integer("voided_by_user_id").references(() => users.id),
  voidReason: text("void_reason"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  entryDateIndex: index("finance_entries_entry_date_idx").on(table.entryDate),
  typeStatusIndex: index("finance_entries_type_status_idx").on(table.entryType, table.status),
  partnerIndex: index("finance_entries_partner_idx").on(table.partnerId),
  amountPositive: check("finance_entries_amount_positive", sql`${table.amount} > 0`),
  directionMatchesType: check(
    "finance_entries_direction_matches_type",
    sql`(${table.entryType} IN ('income', 'partner_deposit', 'opening_balance') AND ${table.direction} = 'credit')
      OR (${table.entryType} IN ('expense', 'partner_withdrawal') AND ${table.direction} = 'debit')`
  ),
  partnerConsistency: check(
    "finance_entries_partner_consistency",
    sql`(${table.entryType} IN ('partner_deposit', 'partner_withdrawal')
          AND ${table.partnerId} IS NOT NULL AND ${table.fundingKind} IS NOT NULL)
      OR (${table.entryType} IN ('income', 'expense', 'opening_balance')
          AND ${table.partnerId} IS NULL AND ${table.fundingKind} IS NULL)`
  ),
}));

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
  // The audit payload each transfer action writes (creation count, approval totals, rejection
  // reason, who executed/cancelled it, free-text notes). Declared explicitly so the `values()`
  // calls in server/routes.ts type-check instead of rejecting every extra key.
  actionData: jsonb("action_data").$type<{
    notes?: string;
    approvedQuantity?: number;
    rejectionReason?: string;
    itemCount?: number;
    approvedItems?: number;
    reason?: string;
    executedBy?: string;
    cancelledBy?: string;
  }>(),
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
  vatCompany: one(vatCompanies, {
    fields: [invoiceCounters.vatCompanyId],
    references: [vatCompanies.id],
  }),
}));

// Add relations for the VAT companies (one sequence, many invoices)
export const vatCompaniesRelations = relations(vatCompanies, ({ many }) => ({
  salesTransactions: many(salesTransactions),
  invoiceCounters: many(invoiceCounters),
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
  vatCompany: one(vatCompanies, {
    fields: [salesTransactions.vatCompanyId],
    references: [vatCompanies.id],
  }),
}));

// Add relations for the receivables register
export const invoicesRelations = relations(invoices, ({ many, one }) => ({
  payments: many(invoicePayments),
  salesTransaction: one(salesTransactions, {
    fields: [invoices.salesTransactionId],
    references: [salesTransactions.id],
  }),
  salesOrder: one(salesOrders, {
    fields: [invoices.salesOrderId],
    references: [salesOrders.id],
  }),
  vatCompany: one(vatCompanies, {
    fields: [invoices.vatCompanyId],
    references: [vatCompanies.id],
  }),
  customerProfile: one(customerProfiles, {
    fields: [invoices.customerProfileId],
    references: [customerProfiles.id],
  }),
  store: one(stores, {
    fields: [invoices.storeId],
    references: [stores.id],
  }),
}));

export const invoicePaymentsRelations = relations(invoicePayments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoicePayments.invoiceId],
    references: [invoices.id],
  }),
  receivedByUser: one(users, {
    fields: [invoicePayments.receivedByUserId],
    references: [users.id],
  }),
  voidedByUser: one(users, {
    fields: [invoicePayments.voidedByUserId],
    references: [users.id],
  }),
  store: one(stores, {
    fields: [invoicePayments.storeId],
    references: [stores.id],
  }),
}));

export const financePartnersRelations = relations(financePartners, ({ many }) => ({
  entries: many(financeEntries),
}));

export const financeEntriesRelations = relations(financeEntries, ({ one }) => ({
  partner: one(financePartners, {
    fields: [financeEntries.partnerId],
    references: [financePartners.id],
  }),
  createdByUser: one(users, {
    fields: [financeEntries.createdByUserId],
    references: [users.id],
  }),
  voidedByUser: one(users, {
    fields: [financeEntries.voidedByUserId],
    references: [users.id],
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
  // The location the goods leave from; null = the Distribution Centre.
  store: one(stores, {
    fields: [salesOrders.storeId],
    references: [stores.id],
  }),
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
  // Who cancelled the note; null until a cancellation happens.
  cancelledByUser: one(users, {
    fields: [deliveryNotes.cancelledByUserId],
    references: [users.id],
  }),
  // The location the goods left from; null = the Distribution Centre.
  store: one(stores, {
    fields: [deliveryNotes.storeId],
    references: [stores.id],
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
// Phone numbers are normalised (separators stripped, leading `+` kept) before they are stored,
// so the API cannot accept `+84-930-123-456` and `+84930123456` as two different customers.
// shared/phone.ts does the same thing in the form as the user types.
export const insertCustomerProfileSchema = createInsertSchema(customerProfiles, {
  mobileNumber: z.string()
    .transform(normalizePhoneNumber)
    .refine((value) => value.length > 0, "Mobile number is required")
    .refine((value) => value.length <= 20, "Mobile number is too long")
    // Checked after normalising, so `+84-930-123-456` is accepted and stored as `+84930123456`,
    // while a value that is only separators (`+ - `) still fails.
    .refine((value) => MOBILE_NUMBER_PATTERN.test(value), "Invalid mobile number format"),
  // Trimmed at the boundary: a B2B profile typed "  Acme  " must not print with the padding,
  // and an empty box is stored as NULL so `companyName || contactPerson` reads naturally.
  companyName: z.string()
    .max(255, "Company name is too long")
    .optional()
    .nullable()
    .transform((value) => value?.trim() || null),
  contactPerson: z.string().min(1, "Contact person is required"),
  email: z.string().email("Invalid email address"),
  address: z.string().min(1, "Address is required"),
  photo: z.string().nullable().optional(),
  landLineNumber: z.string()
    .nullable()
    .optional()
    .transform((value) => (value ? normalizePhoneNumber(value).slice(0, 20) : null)),
  // Optional: a consumer has none. Grouping spaces are stripped, then the shape is checked, so a
  // pasted `0313 623 838` is stored as `0313623838` and a typo can never reach an invoice.
  taxId: z.string()
    .max(50, "Tax code is too long")
    .nullable()
    .optional()
    .transform((value) => normalizeTaxCode(value))
    .refine((value) => value === "" || TAX_CODE_PATTERN.test(value), "Invalid tax code format"),
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

// Receivables register (invoices + the payment receipts recorded against them)
export const insertInvoiceSchema = createInsertSchema(invoices);
export const selectInvoiceSchema = createSelectSchema(invoices);
export type InsertInvoice = typeof invoices.$inferInsert;
export type SelectInvoice = typeof invoices.$inferSelect;

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments);
export const selectInvoicePaymentSchema = createSelectSchema(invoicePayments);
export type InsertInvoicePayment = typeof invoicePayments.$inferInsert;
export type SelectInvoicePayment = typeof invoicePayments.$inferSelect;

// Financial accounts: the manual money book and the partners who fund the company
export const insertFinancePartnerSchema = createInsertSchema(financePartners);
export const selectFinancePartnerSchema = createSelectSchema(financePartners);
export type InsertFinancePartner = typeof financePartners.$inferInsert;
export type SelectFinancePartner = typeof financePartners.$inferSelect;

export const insertFinanceEntrySchema = createInsertSchema(financeEntries);
export const selectFinanceEntrySchema = createSelectSchema(financeEntries);
export type InsertFinanceEntry = typeof financeEntries.$inferInsert;
export type SelectFinanceEntry = typeof financeEntries.$inferSelect;

// VAT company schemas
export const insertVatCompanySchema = createInsertSchema(vatCompanies);
export const selectVatCompanySchema = createSelectSchema(vatCompanies);
export type InsertVatCompany = typeof vatCompanies.$inferInsert;
export type SelectVatCompany = typeof vatCompanies.$inferSelect;

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
 * The company letterhead - exactly one row, forever.
 *
 * Every printed document (sales order, delivery note, receipt, purchase order) and the
 * band at the top of every screen read this row; see `shared/company.ts` for the single
 * field list both sides use. Two letterheads on two documents is the bug this table is
 * shaped to prevent, so "there is only one company" is a database fact rather than an
 * API convention: `id` is pinned to 1 by a CHECK, and the API never inserts a second row.
 *
 * Columns are NOT NULL with an empty default because "no letterhead yet" is a valid,
 * repairable state (the app opens on a fresh database and asks for setup) whereas a NULL
 * would have to be special-cased by every reader. Completeness is judged field by field
 * in `missingCompanyFields()`, not by the presence of a row.
 */
export const company = pgTable("company", {
  id: integer("id").primaryKey(),
  companyName: text("company_name").notNull().default(""),
  registeredAddress: text("registered_address").notNull().default(""),
  deliveryAddress: text("delivery_address").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  singletonCheck: check("company_singleton_check", sql`${table.id} = 1`),
}));

/**
 * Global key/value settings - one row per setting, read and written by the screens that need
 * a default that is not attached to a single record.
 *
 * The first user is the VAT Margin Calculator: the income-tax rate is the same for every
 * statement, so it lives here rather than being re-typed for each document. The keys are
 * namespaced (`vat_margin.income_tax_rate`, ...) so an unrelated screen can add its own
 * without a second table; `server/vat-margin-settings.ts` owns the vocabulary and the defaults.
 *
 * AI Agent Note: values are TEXT on purpose - a setting is a serialised scalar, and the code
 * that owns the key decides how to read it. Storing a typed column per setting would mean a
 * schema change every time a screen wants a default, which is exactly what this table avoids.
 * `updatedByUserId` is nullable because a setting may be seeded by a migration or a boot task
 * with no signed-in user behind it.
 */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 120 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
});

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
/**
 * Why an inventory quantity changed, in the vocabulary the transaction list shows.
 *
 * AI Agent Note: `stockMovements.reason` is the internal, short-lived vocabulary of the
 * writer; `transactionType` is the audited business reason shown to users. Keep both -
 * the reason column is read by older code paths (and the stock-take screen looks for
 * `ref_type = 'stock_take'`), while reports and the UI group by `transactionType`.
 */
export const INVENTORY_TRANSACTION_TYPES = [
  'PURCHASE_ORDER',
  'SALES_ORDER',
  'PHYSICAL_COUNT',
  'BULK_IMPORT',
  'MANUAL_ADJUSTMENT',
  'STOCK_TRANSFER',
  'RETURN',
  'DAMAGE_OR_WRITE_OFF',
] as const;

export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number];

/** One row of a bulk import's result, stored on `inventoryImportFiles.result`. */
export interface InventoryImportRowResult {
  /** 1-based row number in the uploaded file (header = row 1). */
  row: number;
  sku?: string;
  product?: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  message?: string;
  inventoryId?: number;
  quantityBefore?: number;
  quantityAfter?: number;
  quantityChange?: number;
}

/**
 * The original spreadsheet behind a bulk inventory import.
 *
 * AI Agent Note: an import sets quantities outright, so the imported numbers must be
 * reproducible long after the fact - the parsed rows alone cannot prove what the user
 * actually uploaded. Retaining the bytes (plus the per-row result) makes an import
 * auditable and lets an operator re-download the file that caused a change.
 */
export const inventoryImportFiles = pgTable("inventory_import_files", {
  id: serial("id").primaryKey(),
  originalFileName: text("original_file_name").notNull(),
  /** Public, servable path ("/uploads/inventory-imports/...") - same pattern as delivery notes. */
  storedFileUrl: text("stored_file_url").notNull(),
  mimeType: varchar("mime_type", { length: 120 }),
  fileSize: integer("file_size"),
  // 'processing' while the rows are applied, then 'completed' or 'failed'.
  status: varchar("status", { length: 20 }).notNull().default("processing"),
  totalRows: integer("total_rows").notNull().default(0),
  createdRows: integer("created_rows").notNull().default(0),
  updatedRows: integer("updated_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
  // Per-row success/failure, so a failure can be explained row by row.
  result: jsonb("result").$type<InventoryImportRowResult[]>().notNull().default(sql`'[]'::jsonb`),
  uploadedByUserId: integer("uploaded_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  createdIdx: index("inventory_import_files_created_idx").on(table.createdAt),
}));

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  inventoryId: integer("inventory_id").notNull(),

  productId: integer("product_id"),
  storeId: integer("store_id"),
  // Signed change applied to the row: negative leaves the shelf, positive arrives on it.
  delta: integer("delta").notNull(),
  // `inventory.quantity` immediately before this change, when known. Derived from
  // `quantityAfter - delta` by the ledger writer, so it is always self-consistent.
  quantityBefore: integer("quantity_before"),
  // Cached quantity of `inventory.quantity` immediately after this change, when known.
  quantityAfter: integer("quantity_after"),
  // Why the quantity changed, in the audited vocabulary (`INVENTORY_TRANSACTION_TYPES`).
  transactionType: varchar("transaction_type", { length: 32 })
    .$type<InventoryTransactionType>()
    .notNull()
    .default("MANUAL_ADJUSTMENT"),
  // 'sale' | 'refund' | 'cancel' | 'transfer_in' | 'transfer_out' | 'po_receipt' | 'adjustment'
  reason: varchar("reason", { length: 24 }).notNull(),
  // The document that caused it: ('sales_transaction', 42), ('purchase_order', 7),
  // ('delivery_note', 9) for a sales-order shipment, ...
  refType: varchar("ref_type", { length: 40 }),
  refId: integer("ref_id"),
  // The retained upload behind a bulk import, when this movement came from one.
  importFileId: integer("import_file_id"),
  // Free-text justification for manual changes ("damaged in transit", stock-take note).
  // The `reason` column is a fixed vocabulary, so the human explanation goes here.
  note: text("note"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  inventoryIdx: index("stock_movements_inventory_idx").on(table.inventoryId, table.createdAt),
  reasonIdx: index("stock_movements_reason_idx").on(table.reason),
  typeIdx: index("stock_movements_type_idx").on(table.transactionType, table.createdAt),
}));

// Proof documents on a transaction: a photo of the paper receipt, a bank-transfer screenshot,
// the supplier's delivery note, customs paperwork.
//
// AI Agent Note - `entity_type` + `entity_id` is a deliberate polymorphic pair instead of one
// nullable FK per table: a document belongs to exactly one transaction, and the supported kinds
// are pinned by the CHECK below (`ATTACHMENT_ENTITY_TYPES` in shared/attachments.ts). There is no
// FK to the parent because there is no single parent table to point at; the API refuses an
// attachment when the transaction does not exist (server/attachments.ts). The bytes are written to
// `uploads/attachments/` and only the short URL is stored, exactly like products and delivery
// notes, so a money list never carries image payloads.
export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  // 'purchase_order' | 'goods_receipt' | 'invoice_payment' | 'finance_entry'
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: integer("entity_id").notNull(),
  // The name the file had on the device ("IMG_2041.jpg", "transfer-2024-05-02.png").
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  // `/uploads/attachments/<file>` - served by `express.static` in server/index.ts.
  url: varchar("url", { length: 500 }).notNull(),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  entityIdx: index("attachments_entity_idx").on(table.entityType, table.entityId),
  entityTypeCheck: check(
    "attachments_entity_type_check",
    sql`${table.entityType} IN ('purchase_order', 'goods_receipt', 'invoice_payment', 'finance_entry')`
  ),
}));

// The company letterhead is a singleton, so the whole table is exposed as one
// insert/select schema pair rather than a list. The primary key is pinned by
// `COMPANY_SINGLETON_ID` in shared/company.ts and by a CHECK constraint.
export const insertCompanySchema = createInsertSchema(company);
export const selectCompanySchema = createSelectSchema(company);
export type InsertCompany = typeof company.$inferInsert;
export type SelectCompany = typeof company.$inferSelect;
