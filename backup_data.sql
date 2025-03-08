-- Table: role_types
INSERT INTO role_types (id, description) VALUES
(1, 'System Administrator'),
(2, 'System Administrator'),
(3, 'Pet Store User'),
(4, 'Distribution Center User');

-- Table: users
INSERT INTO users (id, username, password, role_id, created_at, updated_at) VALUES
(4, 'admin', '29a210975f65b012a0ee4ed4095c32bd0470f38389168f9a8e0d7e45ff3245d0bf1e7b8fead8a5dd7ec6673979359541742637bbf001dcb8b3554dcc366a1054.921dbb420f0afa2d4dacb5073ed74177', 12, '2025-03-06 12:12:02.19142', '2025-03-06 12:12:02.19142');

-- Table: roles
INSERT INTO roles (id, name, description, role_type_id, permissions, created_at, updated_at) VALUES
(12, 'admin', 'Administrator role with full access', 1, '{"users":{"read":true,"create":true,"delete":true,"update":true},"orders":{"read":true,"create":true,"delete":true,"update":true},"products":{"read":true,"create":true,"delete":true,"update":true},"inventory":{"read":true,"create":true,"delete":true,"update":true}}', '2025-03-06 12:12:00.968734', '2025-03-06 12:12:00.968734'),
(85, 'dddd', 'ddddd', 3, '{"users":{"read":true,"create":true,"delete":true,"update":true},"orders":{"read":true,"create":true,"delete":true,"update":true},"products":{"read":true,"create":true,"delete":true,"update":true},"inventory":{"read":true,"create":true,"delete":true,"update":true}}', '2025-03-07 08:58:33.084406', '2025-03-07 08:58:33.084406');

-- Table: stores
INSERT INTO stores (id, name, location, contact_info, created_at, updated_at) VALUES
(2, 'D1 Store', 'D1 Street', 'D1 Supervisor', '2025-03-07 04:18:36.415027', '2025-03-07 04:18:36.415027'),
(3, 'D2 Store', 'D2 Street ', 'D2 Person', '2025-03-07 04:21:45.314882', '2025-03-07 04:21:45.314882');

-- Table: categories
INSERT INTO categories (id, name, description, created_at, updated_at) VALUES
(2, 'Accessories', 'Accessories', '2025-03-06 12:28:46.916194', '2025-03-06 12:28:46.916194');

-- Table: brands
INSERT INTO brands (id, name, description, created_at, updated_at) VALUES
(2, 'P-Link', 'P-Link Brand', '2025-03-06 12:29:02.935932', '2025-03-06 12:29:02.935932');

-- Table: products
INSERT INTO products (id, name, description, sku, price, category_id, brand_id, min_stock, created_at, updated_at) VALUES
(1, 'Chain', 'Chain', '32324', '233.00', 2, 2, 10, '2025-03-06 12:39:05.672311', '2025-03-06 12:39:05.672311');

-- Table: suppliers
INSERT INTO suppliers (id, name, contact_info, address, created_at, updated_at) VALUES
(1, 'ABC Supplies', 'Rom', '123, Street, Mac Road, Vietnam', '2025-03-06 11:38:41.513262', '2025-03-06 11:38:41.513262');

-- Table: customer_profiles
INSERT INTO customer_profiles (id, phone_number, name, email, address, photo, pet_birthday, pet_type, created_at, updated_at) VALUES
(1, '+90909090', 'Peter', 'pete@pete.com', '677, River Side', NULL, '2022-10-07', 'CAT', '2025-03-07 06:07:09.264836', '2025-03-07 06:07:09.264836');

-- Table: inventory
INSERT INTO inventory (id, product_id, store_id, supplier_id, quantity, location, inventory_type, center_id, barcode, purchase_date, expiry_date, updated_at) VALUES
(1, 1, NULL, 1, 10, '', 'DC', 'DC001', 'DC000323247029', NULL, NULL, '2025-03-07 04:22:15.372401'),
(2, 1, 3, 1, 10, 'B2 Rack', 'STORE', 'DC001', 'ST003323242492', NULL, NULL, '2025-03-07 04:28:13.368552');

-- Table: purchase_orders
INSERT INTO purchase_orders (id, order_number, supplier_id, order_date, delivery_date, status, total_amount, notes, created_at, updated_at) VALUES
(1, 'PO-20250307-5431', 1, '2025-03-07 04:36:01.892152', '2025-03-13 21:35:00', 'pending', '1665.00', 'Delivery between 3 to 4 pm ', '2025-03-07 04:36:01.892152', '2025-03-07 04:36:01.892152');

-- Table: purchase_order_items
INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, total_price, delivered_quantity, created_at, updated_at) VALUES
(1, 1, 1, 5, '333.00', '1665.00', 0, '2025-03-07 04:36:02.146616', '2025-03-07 04:36:02.146616');

