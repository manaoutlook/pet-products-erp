CREATE TABLE "invoice_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer,
	"counter_type" varchar(10) NOT NULL,
	"current_number" integer DEFAULT 0 NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sales_transaction_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sales_transaction_id" integer NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"action_data" jsonb,
	"performed_by_user_id" integer NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sales_transaction_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sales_transaction_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"inventory_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"total_price" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sales_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"store_id" integer,
	"transaction_type" varchar(20) NOT NULL,
	"cashier_user_id" integer NOT NULL,
	"customer_profile_id" integer,
	"total_amount" numeric(15, 2) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"transaction_date" timestamp DEFAULT now(),
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sales_transactions_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "transfer_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_request_id" integer NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"action_data" jsonb,
	"performed_by_user_id" integer NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transfer_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_request_id" integer NOT NULL,
	"from_inventory_id" integer NOT NULL,
	"to_inventory_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"transferred_at" timestamp DEFAULT now(),
	"transferred_by_user_id" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "transfer_request_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_request_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"requested_quantity" integer NOT NULL,
	"approved_quantity" integer,
	"transferred_quantity" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transfer_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_number" varchar(50) NOT NULL,
	"from_store_id" integer,
	"to_store_id" integer,
	"requested_by_user_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"notes" text,
	"requested_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "transfer_requests_transfer_number_unique" UNIQUE("transfer_number")
);
--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction_actions" ADD CONSTRAINT "sales_transaction_actions_sales_transaction_id_sales_transactions_id_fk" FOREIGN KEY ("sales_transaction_id") REFERENCES "public"."sales_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction_actions" ADD CONSTRAINT "sales_transaction_actions_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction_items" ADD CONSTRAINT "sales_transaction_items_sales_transaction_id_sales_transactions_id_fk" FOREIGN KEY ("sales_transaction_id") REFERENCES "public"."sales_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction_items" ADD CONSTRAINT "sales_transaction_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction_items" ADD CONSTRAINT "sales_transaction_items_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_actions" ADD CONSTRAINT "transfer_actions_transfer_request_id_transfer_requests_id_fk" FOREIGN KEY ("transfer_request_id") REFERENCES "public"."transfer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_actions" ADD CONSTRAINT "transfer_actions_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_transfer_request_id_transfer_requests_id_fk" FOREIGN KEY ("transfer_request_id") REFERENCES "public"."transfer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_from_inventory_id_inventory_id_fk" FOREIGN KEY ("from_inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_to_inventory_id_inventory_id_fk" FOREIGN KEY ("to_inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_history" ADD CONSTRAINT "transfer_history_transferred_by_user_id_users_id_fk" FOREIGN KEY ("transferred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_items" ADD CONSTRAINT "transfer_request_items_transfer_request_id_transfer_requests_id_fk" FOREIGN KEY ("transfer_request_id") REFERENCES "public"."transfer_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_items" ADD CONSTRAINT "transfer_request_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_from_store_id_stores_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_to_store_id_stores_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;