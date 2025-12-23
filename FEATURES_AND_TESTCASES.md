# Pet Products ERP - Features and Test Cases

## Table of Contents
1. [Application Features](#application-features)
2. [User Roles and Permissions](#user-roles-and-permissions)
3. [Comprehensive Test Cases](#comprehensive-test-cases)

---

## Application Features

### 1. **Authentication & Authorization**
- **User Login/Logout**: Secure authentication with hashed passwords (bcrypt/scrypt)
- **Role-Based Access Control (RBAC)**: Granular permissions for different user types
- **System Administrator Flag**: Special flag for system-level admin access
- **Session Management**: Persistent user sessions

### 2. **Dashboard**
- **Overview Page**: Central hub for accessing all modules
- **Quick Navigation**: Access to all permitted features based on user role

### 3. **Master Data Management**
#### 3.1 Categories
- Create, read, update, delete product categories
- Category descriptions
- Unique category names

#### 3.2 Brands
- Manage pet product brands
- Brand descriptions
- Unique brand names

#### 3.3 Suppliers
- Supplier contact information management
- Supplier addresses
- Track supplier relationships

### 4. **Product Management**
- **Product CRUD Operations**: Create, read, update, delete products
- **Product Attributes**:
  - Name, description, SKU (unique)
  - Price (VND currency)
  - Category assignment
  - Brand assignment
  - Minimum stock levels
- **Product Search & Filtering**
- **Product Categorization**

### 5. **Inventory Management**
#### 5.1 Inventory Tracking
- Track inventory across multiple stores and warehouses
- Store-specific inventory levels
- Warehouse (Distribution Center) inventory
- Product-supplier relationships
- Barcode generation and tracking
- Purchase and expiry date tracking
- Inventory location tracking

#### 5.2 Inventory Transfer System
- **Transfer Requests**: Create inter-store transfer requests
- **Transfer Workflow**:
  - Pending → Approved → In Transit → Completed
  - Rejection capability with reasons
- **Transfer Priority Levels**: Normal, High, Urgent
- **Transfer History**: Complete audit trail
- **Transfer Actions**: Approval/rejection tracking
- **Multi-item Transfers**: Transfer multiple products in one request

### 6. **Purchase Order Management**
- **Purchase Order Creation**: Create POs for suppliers
- **PO Attributes**:
  - Order number (auto-generated)
  - Supplier selection
  - Destination warehouse/DC
  - Order and delivery dates
  - Status tracking (pending, confirmed, shipped, delivered, cancelled)
  - Total amount calculation
  - Notes and references
- **PO Items Management**: Multiple line items per PO
- **PO Actions Tracking**:
  - Cancel orders
  - Print POs
  - Invoice received
  - Payment sent
  - Goods receipt
- **Delivered Quantity Tracking**: Track partial deliveries

### 7. **Point of Sale (POS)**
- **Sales Transaction Processing**:
  - Store sales
  - Distribution center sales
- **Invoice Generation**:
  - Auto-generated invoice numbers
  - Store-specific invoice counters
- **Customer Integration**: Link sales to customer profiles
- **Payment Methods**: Multiple payment method support
- **Inventory Deduction**: Automatic inventory updates on sale
- **Transaction Status**: Completed, refunded, voided
- **Cashier Tracking**: Track which user processed the sale

### 8. **Receipts Management**
- **Receipt Viewing**: View all sales receipts
- **Receipt Search & Filter**
- **Transaction Details**: Complete transaction information
- **Receipt Actions**:
  - View receipt details
  - Refund processing
  - Void transactions
- **Audit Trail**: Track all receipt-related actions

### 9. **Store Management**
#### 9.1 Store Operations
- **Store Types**:
  - Retail stores
  - Warehouses/Distribution Centers (DC)
- **Store Information**:
  - Name, location
  - Contact information
  - Store type designation
- **Multi-store Support**: Manage multiple locations

#### 9.2 Store Analytics
- **Store Performance Metrics**
- **Sales Analytics by Store**
- **Inventory Levels by Store**

#### 9.3 Store Assignments
- **User-Store Mapping**: Assign users to specific stores
- **Multi-store Access**: Users can be assigned to multiple stores
- **Access Control**: Store-level access restrictions

### 10. **Customer Management**
- **Customer Profiles**:
  - Phone number (unique identifier)
  - Name, email, address
  - Customer photo
  - Pet information (type: CAT/DOG)
  - Pet birthday tracking
- **Customer History**: Link to orders and sales
- **Customer Search**: Find customers by phone, name, or email

### 11. **User Management**
#### 11.1 User Administration
- **User CRUD Operations**: Create, read, update, delete users
- **User Attributes**:
  - Username (unique)
  - Password (hashed)
  - Role assignment
- **User-Store Assignments**: Manage which stores users can access

#### 11.2 Role Management
- **Role CRUD Operations**: Create, read, update, delete roles
- **System Admin Flag**: Designate system administrators
- **Role Descriptions**: Document role purposes

#### 11.3 Permission Management
- **Granular Permissions**: 8 permission modules
  - Products: create, read, update, delete
  - Orders: create, read, update, delete
  - Inventory: create, read, update, delete
  - Users: create, read, update, delete
  - Stores: create, read, update, delete
  - Master Data: create, read, update, delete
  - POS: create, read, update, delete
  - Receipts: create, read, update, delete
- **Permission Matrix**: Visual permission configuration
- **Role-based Access**: Automatic UI/feature filtering based on permissions

### 12. **Audit & Tracking**
- **Purchase Order Actions**: Complete action history
- **Sales Transaction Actions**: Refund/void tracking
- **Transfer Actions**: Approval/rejection history
- **Transfer History**: Inventory movement audit trail
- **Timestamps**: Created/updated timestamps on all entities

### 13. **Invoice & Numbering System**
- **Auto-generated Numbers**:
  - Purchase order numbers
  - Transfer request numbers
  - Invoice numbers
- **Store-specific Counters**: Separate numbering for each store
- **Counter Types**: Store and DC counters
- **Prefix Support**: Customizable number prefixes

---

## User Roles and Permissions

### Default Roles in the System

#### 1. **System Administrator** (admin)
- **isSystemAdmin**: true
- **Access**: Full access to all features and all stores
- **Default Credentials**: admin / admin123

#### 2. **Regional Manager** (regional_manager)
- **Permissions**: Nearly full access except user deletion
- **Products**: Full CRUD
- **Orders**: Full CRUD
- **Inventory**: Full CRUD
- **Users**: Create, read, update (no delete)
- **Stores**: Create, read, update (no delete)
- **Master Data**: Full CRUD
- **POS**: Full CRUD
- **Receipts**: Full CRUD
- **Store Access**: All stores

#### 3. **Store Manager** (store_manager)
- **Permissions**: Operational management of assigned stores
- **Products**: Create, read, update (no delete)
- **Orders**: Create, read, update (no delete)
- **Inventory**: Create, read, update (no delete)
- **Users**: Read only
- **Stores**: Read only
- **Master Data**: Read only
- **POS**: Create, read, update (no delete)
- **Receipts**: Create, read, update (no delete)
- **Store Access**: Assigned stores only

#### 4. **Sales Associate** (sales_associate)
- **Permissions**: Customer-facing operations
- **Products**: Read only
- **Orders**: Create, read, update (no delete)
- **Inventory**: Read only
- **Users**: No access
- **Stores**: Read only
- **Master Data**: Read only
- **POS**: Create, read, update (no delete)
- **Receipts**: Create, read, update (no delete)
- **Store Access**: Assigned stores only

#### 5. **Inventory Clerk** (inventory_clerk)
- **Permissions**: Inventory and supplier management
- **Products**: Read only
- **Orders**: No access
- **Inventory**: Create, read, update (no delete)
- **Users**: No access
- **Stores**: Read only
- **Master Data**: Create, read, update (no delete)
- **POS**: Read only
- **Receipts**: Read only
- **Store Access**: Assigned stores only

#### 6. **Customer Service** (customer_service)
- **Permissions**: Customer support and inquiry handling
- **Products**: Read only
- **Orders**: Read only
- **Inventory**: Read only
- **Users**: No access
- **Stores**: Read only
- **Master Data**: Read only
- **POS**: Read only
- **Receipts**: Create, read (no update/delete)
- **Store Access**: All stores (typically)

---

## Comprehensive Test Cases

### Test Case Organization
- **TC-XXX-YY**: Test Case ID (Module-Scenario-Number)
- **Priority**: Critical, High, Medium, Low
- **Test Type**: Functional, Security, Integration, UI

---

### 1. Authentication & Authorization Test Cases

#### TC-AUTH-01: System Administrator Login
**Priority**: Critical | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Navigate to login page
  2. Enter username: "admin"
  3. Enter password: "admin123"
  4. Click login
- **Expected Result**: 
  - Login successful
  - Redirected to dashboard
  - All menu items visible
  - User info shows "admin" role

#### TC-AUTH-02: Invalid Login Credentials
**Priority**: Critical | **Type**: Security
- **Role**: Any
- **Steps**:
  1. Navigate to login page
  2. Enter username: "admin"
  3. Enter password: "wrongpassword"
  4. Click login
- **Expected Result**: 
  - Login fails
  - Error message displayed
  - User remains on login page

#### TC-AUTH-03: Role-Based Menu Visibility - Sales Associate
**Priority**: High | **Type**: Functional
- **Role**: Sales Associate (mike_sales / password123)
- **Steps**:
  1. Login as sales associate
  2. Observe sidebar menu
- **Expected Result**: 
  - Dashboard visible
  - Products (read-only) visible
  - POS visible
  - Receipts visible
  - Master Data visible (read-only)
  - User Management NOT visible
  - Roles NOT visible
  - Permissions NOT visible

#### TC-AUTH-04: Logout Functionality
**Priority**: High | **Type**: Functional
- **Role**: Any authenticated user
- **Steps**:
  1. Login as any user
  2. Click logout button in sidebar
- **Expected Result**: 
  - User logged out
  - Redirected to login page
  - Session cleared

#### TC-AUTH-05: Session Persistence
**Priority**: Medium | **Type**: Functional
- **Role**: Any authenticated user
- **Steps**:
  1. Login as any user
  2. Refresh the page
- **Expected Result**: 
  - User remains logged in
  - Same page displayed
  - No redirect to login

---

### 2. Master Data Management Test Cases

#### TC-MASTER-01: Create Category - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Categories
  3. Click "Add Category"
  4. Enter name: "Test Category"
  5. Enter description: "Test Description"
  6. Click Save
- **Expected Result**: 
  - Category created successfully
  - Success message displayed
  - Category appears in list

#### TC-MASTER-02: Create Category - Sales Associate (Denied)
**Priority**: High | **Type**: Security
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Categories
  3. Attempt to click "Add Category" button
- **Expected Result**: 
  - "Add Category" button not visible or disabled
  - No create permission

#### TC-MASTER-03: Create Duplicate Category
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Categories
  3. Create category "Duplicate Test"
  4. Attempt to create another category "Duplicate Test"
- **Expected Result**: 
  - Error message: Category name must be unique
  - Second category not created

#### TC-MASTER-04: Update Brand - Inventory Clerk
**Priority**: High | **Type**: Functional
- **Role**: Inventory Clerk (anna_inventory / password123)
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Brands
  3. Select existing brand
  4. Click Edit
  5. Update description
  6. Click Save
- **Expected Result**: 
  - Brand updated successfully
  - Changes reflected in list

#### TC-MASTER-05: Delete Brand - Inventory Clerk (Denied)
**Priority**: High | **Type**: Security
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Brands
  3. Select existing brand
  4. Look for Delete button
- **Expected Result**: 
  - Delete button not visible
  - No delete permission

#### TC-MASTER-06: Create Supplier - Regional Manager
**Priority**: High | **Type**: Functional
- **Role**: Regional Manager (regional_boss / password123)
- **Steps**:
  1. Login as regional manager
  2. Navigate to Suppliers
  3. Click "Add Supplier"
  4. Enter name: "Test Supplier Co."
  5. Enter contact info: "555-1234"
  6. Enter address: "123 Test St"
  7. Click Save
- **Expected Result**: 
  - Supplier created successfully
  - Appears in supplier list

#### TC-MASTER-07: View Suppliers - Customer Service
**Priority**: Medium | **Type**: Functional
- **Role**: Customer Service (jane_service / password123)
- **Steps**:
  1. Login as customer service
  2. Navigate to Suppliers
  3. View supplier list
- **Expected Result**: 
  - Supplier list visible
  - No create/edit/delete buttons visible
  - Read-only access

---

### 3. Product Management Test Cases

#### TC-PROD-01: Create Product - Store Manager
**Priority**: Critical | **Type**: Functional
- **Role**: Store Manager (john_manager / password123)
- **Steps**:
  1. Login as store manager
  2. Navigate to Products
  3. Click "Add Product"
  4. Enter name: "Premium Dog Food"
  5. Enter SKU: "PDF-001"
  6. Enter price: "250000" (VND)
  7. Select category
  8. Select brand
  9. Set min stock: 10
  10. Click Save
- **Expected Result**: 
  - Product created successfully
  - Product appears in list with all details

#### TC-PROD-02: Create Product with Duplicate SKU
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Create product with SKU "DUP-001"
  3. Attempt to create another product with SKU "DUP-001"
- **Expected Result**: 
  - Error message: SKU must be unique
  - Second product not created

#### TC-PROD-03: Update Product Price - Regional Manager
**Priority**: High | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Products
  3. Select existing product
  4. Click Edit
  5. Update price from 250000 to 275000
  6. Click Save
- **Expected Result**: 
  - Product price updated
  - New price reflected in product list

#### TC-PROD-04: Delete Product - Sales Associate (Denied)
**Priority**: High | **Type**: Security
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Products
  3. Select product
  4. Look for Delete option
- **Expected Result**: 
  - Delete button not visible
  - No delete permission

#### TC-PROD-05: View Products - All Roles
**Priority**: Medium | **Type**: Functional
- **Role**: All roles with product read permission
- **Steps**:
  1. Login as each role
  2. Navigate to Products
  3. View product list
- **Expected Result**: 
  - All roles can view products
  - Product list displays correctly

#### TC-PROD-06: Search Products by Name
**Priority**: Medium | **Type**: Functional
- **Role**: Any user with product read permission
- **Steps**:
  1. Login as any user
  2. Navigate to Products
  3. Enter search term in search box
  4. View filtered results
- **Expected Result**: 
  - Products filtered by search term
  - Only matching products displayed

---

### 4. Inventory Management Test Cases

#### TC-INV-01: View Inventory - Inventory Clerk
**Priority**: High | **Type**: Functional
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Inventory
  3. View inventory list
- **Expected Result**: 
  - Inventory list displays
  - Shows product, store, quantity, location
  - Only shows inventory for assigned stores

#### TC-INV-02: Add Inventory - Store Manager
**Priority**: Critical | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Inventory
  3. Click "Add Inventory"
  4. Select product
  5. Select store (assigned store)
  6. Enter quantity: 100
  7. Enter location: "Aisle 5"
  8. Click Save
- **Expected Result**: 
  - Inventory record created
  - Barcode auto-generated
  - Record appears in inventory list

#### TC-INV-03: Update Inventory Quantity - Inventory Clerk
**Priority**: High | **Type**: Functional
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Inventory
  3. Select inventory item
  4. Click Edit
  5. Update quantity from 100 to 150
  6. Click Save
- **Expected Result**: 
  - Quantity updated
  - Updated timestamp refreshed
  - New quantity displayed

#### TC-INV-04: View Inventory by Store Type - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Inventory
  3. Filter by store type: "RETAIL"
  4. View results
  5. Filter by store type: "WAREHOUSE"
  6. View results
- **Expected Result**: 
  - Inventory filtered correctly by store type
  - Retail stores show retail inventory
  - Warehouses show DC inventory

#### TC-INV-05: Low Stock Alert Visibility
**Priority**: Medium | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Inventory
  3. Create/view product with quantity below min stock
- **Expected Result**: 
  - Low stock indicator visible
  - Product highlighted or flagged

---

### 5. Inventory Transfer Test Cases

#### TC-TRANS-01: Create Transfer Request - Store Manager
**Priority**: Critical | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Transfers
  3. Click "Create Transfer Request"
  4. Select from store: "Downtown Pet Store"
  5. Select to store: "Suburban Pet Center"
  6. Add product with quantity: 50
  7. Set priority: "Normal"
  8. Add notes
  9. Click Submit
- **Expected Result**: 
  - Transfer request created
  - Status: "Pending"
  - Transfer number auto-generated
  - Request appears in transfer list

#### TC-TRANS-02: Approve Transfer Request - Regional Manager
**Priority**: Critical | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Transfers
  3. Select pending transfer request
  4. Click "Approve"
  5. Confirm approval
- **Expected Result**: 
  - Transfer status changed to "Approved"
  - Approval action recorded
  - Timestamp captured

#### TC-TRANS-03: Reject Transfer Request - Regional Manager
**Priority**: High | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Transfers
  3. Select pending transfer request
  4. Click "Reject"
  5. Enter rejection reason
  6. Confirm rejection
- **Expected Result**: 
  - Transfer status changed to "Rejected"
  - Rejection reason saved
  - Rejection action recorded

#### TC-TRANS-04: Complete Transfer - Inventory Clerk
**Priority**: Critical | **Type**: Functional
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Transfers
  3. Select approved transfer request
  4. Click "Complete Transfer"
  5. Confirm completion
- **Expected Result**: 
  - Transfer status changed to "Completed"
  - Inventory deducted from source store
  - Inventory added to destination store
  - Transfer history record created

#### TC-TRANS-05: View Transfer History - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Transfers
  3. Select completed transfer
  4. View transfer history/audit trail
- **Expected Result**: 
  - Complete history visible
  - All actions logged (request, approve, complete)
  - Timestamps and user info captured

#### TC-TRANS-06: Create Transfer - Sales Associate (Denied)
**Priority**: High | **Type**: Security
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Transfers
  3. Look for "Create Transfer" button
- **Expected Result**: 
  - Create button not visible or disabled
  - No create permission for transfers

#### TC-TRANS-07: Multi-Product Transfer Request
**Priority**: High | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Transfers
  3. Create new transfer request
  4. Add multiple products (3+)
  5. Set different quantities for each
  6. Submit request
- **Expected Result**: 
  - All products included in transfer
  - Individual quantities tracked
  - Transfer created successfully

---

### 6. Purchase Order Test Cases

#### TC-PO-01: Create Purchase Order - Store Manager
**Priority**: Critical | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Purchase Orders
  3. Click "Create Purchase Order"
  4. Select supplier
  5. Select destination warehouse
  6. Add products with quantities and prices
  7. Enter notes
  8. Click Submit
- **Expected Result**: 
  - PO created successfully
  - PO number auto-generated
  - Status: "Pending"
  - Total amount calculated correctly

#### TC-PO-02: Update PO Status - Regional Manager
**Priority**: High | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Purchase Orders
  3. Select pending PO
  4. Change status to "Confirmed"
  5. Click Save
- **Expected Result**: 
  - Status updated to "Confirmed"
  - Status change recorded
  - Updated timestamp refreshed

#### TC-PO-03: Cancel Purchase Order - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Purchase Orders
  3. Select PO
  4. Click "Cancel Order"
  5. Enter cancellation reason
  6. Confirm cancellation
- **Expected Result**: 
  - PO status changed to "Cancelled"
  - Cancellation action recorded
  - Reason saved in action data

#### TC-PO-04: Record Goods Receipt - Inventory Clerk
**Priority**: Critical | **Type**: Functional
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Purchase Orders
  3. Select delivered PO
  4. Click "Goods Receipt"
  5. Enter delivered quantities
  6. Confirm receipt
- **Expected Result**: 
  - Delivered quantities updated
  - Inventory increased at destination warehouse
  - Goods receipt action recorded

#### TC-PO-05: Partial Delivery Tracking
**Priority**: High | **Type**: Functional
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Purchase Orders
  3. Select PO with ordered quantity: 100
  4. Record goods receipt: 60
  5. View PO details
- **Expected Result**: 
  - Delivered quantity: 60
  - Remaining quantity: 40
  - PO status remains "Shipped" or "Partially Delivered"

#### TC-PO-06: View PO - Sales Associate (Denied)
**Priority**: Medium | **Type**: Security
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Attempt to navigate to Purchase Orders
- **Expected Result**: 
  - Purchase Orders menu not visible
  - No access to PO module

#### TC-PO-07: Print Purchase Order
**Priority**: Medium | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Purchase Orders
  3. Select PO
  4. Click "Print"
- **Expected Result**: 
  - Print action recorded
  - PO details formatted for printing
  - Print dialog opens

---

### 7. Point of Sale (POS) Test Cases

#### TC-POS-01: Process Sale - Sales Associate
**Priority**: Critical | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to POS
  3. Select customer (or create new)
  4. Add products to cart
  5. Select payment method: "Cash"
  6. Complete sale
- **Expected Result**: 
  - Sale processed successfully
  - Invoice number auto-generated
  - Inventory deducted
  - Receipt created
  - Customer linked to sale

#### TC-POS-02: POS Sale with New Customer
**Priority**: High | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to POS
  3. Click "New Customer"
  4. Enter customer details (phone, name, email, address)
  5. Enter pet details (type, birthday)
  6. Save customer
  7. Add products and complete sale
- **Expected Result**: 
  - Customer profile created
  - Customer linked to sale
  - Sale completed successfully

#### TC-POS-03: POS Sale - Multiple Payment Methods
**Priority**: Medium | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to POS
  3. Add products to cart
  4. Test each payment method: Cash, Card, Bank Transfer
- **Expected Result**: 
  - All payment methods work
  - Payment method recorded in transaction

#### TC-POS-04: Inventory Deduction on Sale
**Priority**: Critical | **Type**: Integration
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Note current inventory quantity for product
  3. Navigate to POS
  4. Sell 5 units of product
  5. Navigate to Inventory
  6. Check product quantity
- **Expected Result**: 
  - Inventory reduced by 5 units
  - Inventory update timestamp refreshed
  - Correct inventory ID linked to sale item

#### TC-POS-05: POS Access - Inventory Clerk (Denied)
**Priority**: Medium | **Type**: Security
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to POS
  3. Attempt to create sale
- **Expected Result**: 
  - POS visible but create button disabled/hidden
  - Read-only access
  - Cannot process sales

#### TC-POS-06: Invoice Number Generation
**Priority**: High | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Process sale at Store 1
  3. Note invoice number
  4. Process another sale at Store 1
  5. Note invoice number
- **Expected Result**: 
  - Invoice numbers sequential
  - Store-specific prefix applied
  - No duplicate invoice numbers

---

### 8. Receipts Management Test Cases

#### TC-RCPT-01: View All Receipts - Store Manager
**Priority**: High | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Receipts
  3. View receipt list
- **Expected Result**: 
  - All receipts for assigned stores visible
  - Receipt details displayed (invoice number, date, amount, customer)

#### TC-RCPT-02: Search Receipts by Invoice Number
**Priority**: Medium | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Receipts
  3. Enter invoice number in search
  4. View results
- **Expected Result**: 
  - Specific receipt found
  - Receipt details displayed

#### TC-RCPT-03: View Receipt Details - Customer Service
**Priority**: High | **Type**: Functional
- **Role**: Customer Service
- **Steps**:
  1. Login as customer service
  2. Navigate to Receipts
  3. Select receipt
  4. View full details
- **Expected Result**: 
  - Complete receipt information visible
  - Line items displayed
  - Customer information shown
  - Payment method visible

#### TC-RCPT-04: Process Refund - Regional Manager
**Priority**: Critical | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Receipts
  3. Select completed receipt
  4. Click "Refund"
  5. Enter refund amount
  6. Enter refund reason
  7. Confirm refund
- **Expected Result**: 
  - Receipt status changed to "Refunded"
  - Refund action recorded
  - Inventory restored (if applicable)

#### TC-RCPT-05: Void Transaction - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Receipts
  3. Select receipt
  4. Click "Void"
  5. Enter void reason
  6. Confirm void
- **Expected Result**: 
  - Receipt status changed to "Voided"
  - Void action recorded
  - Inventory restored

#### TC-RCPT-06: Filter Receipts by Date Range
**Priority**: Medium | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Receipts
  3. Set date range filter
  4. Apply filter
- **Expected Result**: 
  - Receipts filtered by date range
  - Only receipts within range displayed

#### TC-RCPT-07: Filter Receipts by Store
**Priority**: Medium | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Receipts
  3. Select store filter
  4. Apply filter
- **Expected Result**: 
  - Receipts filtered by selected store
  - Only receipts from that store displayed

---

### 9. Store Management Test Cases

#### TC-STORE-01: Create Retail Store - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Stores
  3. Click "Add Store"
  4. Enter name: "New Retail Store"
  5. Select type: "RETAIL"
  6. Enter location: "123 Main St"
  7. Enter contact info: "555-5678"
  8. Click Save
- **Expected Result**: 
  - Store created successfully
  - Type set to "RETAIL"
  - Store appears in store list

#### TC-STORE-02: Create Warehouse - Regional Manager
**Priority**: High | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Stores
  3. Click "Add Store"
  4. Enter name: "Central Warehouse"
  5. Select type: "WAREHOUSE"
  6. Enter location and contact info
  7. Click Save
- **Expected Result**: 
  - Warehouse created successfully
  - Type set to "WAREHOUSE"
  - Warehouse appears in store list

#### TC-STORE-03: Update Store Information - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Stores
  3. Select store
  4. Click Edit
  5. Update location and contact info
  6. Click Save
- **Expected Result**: 
  - Store information updated
  - Changes reflected in store list

#### TC-STORE-04: View Store List - Store Manager
**Priority**: Medium | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Stores
  3. View store list
- **Expected Result**: 
  - Store list visible
  - No create/edit/delete buttons (read-only)

#### TC-STORE-05: View Store Analytics - Regional Manager
**Priority**: Medium | **Type**: Functional
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Navigate to Store Analytics
  3. View performance metrics
- **Expected Result**: 
  - Analytics dashboard visible
  - Sales metrics displayed
  - Inventory levels shown
  - Performance comparisons available

#### TC-STORE-06: Filter Stores by Type
**Priority**: Low | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Stores
  3. Filter by type: "RETAIL"
  4. View results
  5. Filter by type: "WAREHOUSE"
  6. View results
- **Expected Result**: 
  - Stores filtered correctly by type
  - Only matching stores displayed

---

### 10. Customer Management Test Cases

#### TC-CUST-01: Create Customer Profile - Sales Associate
**Priority**: High | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Customers
  3. Click "Add Customer"
  4. Enter phone: "0901234567"
  5. Enter name: "John Doe"
  6. Enter email: "john@example.com"
  7. Enter address: "456 Oak Ave"
  8. Select pet type: "DOG"
  9. Enter pet birthday
  10. Click Save
- **Expected Result**: 
  - Customer profile created
  - Phone number unique
  - Customer appears in customer list

#### TC-CUST-02: Create Duplicate Customer (Same Phone)
**Priority**: High | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Create customer with phone "0901111111"
  3. Attempt to create another customer with phone "0901111111"
- **Expected Result**: 
  - Error message: Phone number must be unique
  - Second customer not created

#### TC-CUST-03: Update Customer Profile - Customer Service
**Priority**: Medium | **Type**: Functional
- **Role**: Customer Service
- **Steps**:
  1. Login as customer service
  2. Navigate to Customers
  3. Select customer
  4. Click Edit
  5. Update email and address
  6. Click Save
- **Expected Result**: 
  - Customer information updated
  - Changes reflected in customer list

#### TC-CUST-04: Search Customer by Phone
**Priority**: High | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Customers
  3. Enter phone number in search
  4. View results
- **Expected Result**: 
  - Customer found by phone
  - Customer details displayed

#### TC-CUST-05: Search Customer by Name
**Priority**: Medium | **Type**: Functional
- **Role**: Customer Service
- **Steps**:
  1. Login as customer service
  2. Navigate to Customers
  3. Enter customer name in search
  4. View results
- **Expected Result**: 
  - Customers matching name displayed
  - Partial name matching works

#### TC-CUST-06: View Customer Purchase History
**Priority**: Medium | **Type**: Functional
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Customers
  3. Select customer with purchase history
  4. View customer details
- **Expected Result**: 
  - Customer's orders visible
  - Sales transactions listed
  - Purchase totals displayed

#### TC-CUST-07: Upload Customer Photo
**Priority**: Low | **Type**: Functional
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Navigate to Customers
  3. Edit customer
  4. Upload photo
  5. Save
- **Expected Result**: 
  - Photo uploaded successfully
  - Photo displayed in customer profile

---

### 11. User Management Test Cases

#### TC-USER-01: Create User - Admin
**Priority**: Critical | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Users
  3. Click "Add User"
  4. Enter username: "new_user"
  5. Enter password
  6. Select role: "Sales Associate"
  7. Click Save
- **Expected Result**: 
  - User created successfully
  - Password hashed
  - User appears in user list

#### TC-USER-02: Create Duplicate Username
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Create user "duplicate_user"
  3. Attempt to create another user "duplicate_user"
- **Expected Result**: 
  - Error message: Username must be unique
  - Second user not created

#### TC-USER-03: Update User Role - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Users
  3. Select user
  4. Click Edit
  5. Change role from "Sales Associate" to "Store Manager"
  6. Click Save
- **Expected Result**: 
  - User role updated
  - User's permissions changed accordingly
  - Changes reflected immediately

#### TC-USER-04: Assign User to Store - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Store Assignments
  3. Select user
  4. Select store
  5. Click "Assign"
- **Expected Result**: 
  - User assigned to store
  - Assignment appears in list
  - User can now access that store

#### TC-USER-05: Assign User to Multiple Stores - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Store Assignments
  3. Select user
  4. Assign to Store 1
  5. Assign same user to Store 2
  6. Assign same user to Store 3
- **Expected Result**: 
  - User assigned to all three stores
  - All assignments visible
  - User can access all assigned stores

#### TC-USER-06: Remove Store Assignment - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Store Assignments
  3. Select user-store assignment
  4. Click "Remove"
  5. Confirm removal
- **Expected Result**: 
  - Assignment removed
  - User no longer has access to that store

#### TC-USER-07: View Users - Store Manager (Read Only)
**Priority**: Medium | **Type**: Security
- **Role**: Store Manager
- **Steps**:
  1. Login as store manager
  2. Navigate to Users
  3. View user list
- **Expected Result**: 
  - User list visible
  - No create/edit/delete buttons
  - Read-only access

#### TC-USER-08: Access User Management - Sales Associate (Denied)
**Priority**: High | **Type**: Security
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Attempt to navigate to Users
- **Expected Result**: 
  - User Management menu not visible
  - No access to user module

---

### 12. Role Management Test Cases

#### TC-ROLE-01: Create Role - Admin
**Priority**: Critical | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Roles
  3. Click "Add Role"
  4. Enter name: "warehouse_supervisor"
  5. Enter description: "Warehouse Supervisor Role"
  6. Set isSystemAdmin: false
  7. Configure permissions (all modules)
  8. Click Save
- **Expected Result**: 
  - Role created successfully
  - Permissions saved
  - Role appears in role list

#### TC-ROLE-02: Update Role Permissions - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Roles
  3. Select existing role
  4. Click Edit
  5. Modify permissions (e.g., add delete permission to products)
  6. Click Save
- **Expected Result**: 
  - Role permissions updated
  - Users with this role immediately get new permissions

#### TC-ROLE-03: Create System Admin Role - Admin
**Priority**: High | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Roles
  3. Create new role
  4. Set isSystemAdmin: true
  5. Save role
- **Expected Result**: 
  - System admin role created
  - Users with this role have full access

#### TC-ROLE-04: Delete Role with Assigned Users - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Roles
  3. Select role that has users assigned
  4. Attempt to delete
- **Expected Result**: 
  - Error message: Cannot delete role with assigned users
  - Role not deleted
  - OR: Prompt to reassign users first

#### TC-ROLE-05: View Role Permissions Matrix - Admin
**Priority**: Medium | **Type**: Functional
- **Role**: System Administrator
- **Steps**:
  1. Login as admin
  2. Navigate to Permissions
  3. View permission matrix
- **Expected Result**: 
  - Matrix displays all roles and permissions
  - Visual representation of access levels
  - Easy to compare roles

#### TC-ROLE-06: Access Roles - Regional Manager (Denied)
**Priority**: High | **Type**: Security
- **Role**: Regional Manager
- **Steps**:
  1. Login as regional manager
  2. Attempt to navigate to Roles
- **Expected Result**: 
  - Roles menu not visible
  - Admin-only access enforced

---

### 13. Integration Test Cases

#### TC-INT-01: End-to-End Purchase Order to Inventory
**Priority**: Critical | **Type**: Integration
- **Role**: Multiple roles
- **Steps**:
  1. Admin creates supplier
  2. Store Manager creates purchase order
  3. Regional Manager approves PO
  4. Supplier delivers goods
  5. Inventory Clerk records goods receipt
  6. Verify inventory increased
- **Expected Result**: 
  - Complete workflow successful
  - Inventory updated correctly
  - All actions logged

#### TC-INT-02: End-to-End Sale with Inventory Deduction
**Priority**: Critical | **Type**: Integration
- **Role**: Sales Associate
- **Steps**:
  1. Check initial inventory quantity
  2. Process sale through POS
  3. Verify receipt created
  4. Check inventory quantity again
  5. Verify customer profile linked
- **Expected Result**: 
  - Sale completed
  - Inventory reduced
  - Receipt generated
  - Customer linked

#### TC-INT-03: Transfer Request Complete Workflow
**Priority**: Critical | **Type**: Integration
- **Role**: Multiple roles
- **Steps**:
  1. Store Manager creates transfer request
  2. Regional Manager approves request
  3. Inventory Clerk completes transfer
  4. Verify source inventory reduced
  5. Verify destination inventory increased
  6. Check transfer history
- **Expected Result**: 
  - Complete workflow successful
  - Inventory balanced correctly
  - History recorded

#### TC-INT-04: Multi-Store User Access Control
**Priority**: High | **Type**: Integration
- **Role**: Store Manager assigned to Store 1
- **Steps**:
  1. Login as store manager
  2. View inventory for Store 1 (should see)
  3. Attempt to view inventory for Store 2 (should not see)
  4. Create transfer from Store 1 (should work)
  5. Attempt to create transfer from Store 2 (should fail)
- **Expected Result**: 
  - Access restricted to assigned stores only
  - Cannot perform actions on unassigned stores

#### TC-INT-05: Customer Purchase History Tracking
**Priority**: Medium | **Type**: Integration
- **Role**: Sales Associate
- **Steps**:
  1. Create customer profile
  2. Process 3 sales for this customer
  3. Navigate to customer profile
  4. View purchase history
- **Expected Result**: 
  - All 3 sales visible in history
  - Total purchase amount calculated
  - Purchase dates displayed

---

### 14. Security Test Cases

#### TC-SEC-01: SQL Injection Prevention
**Priority**: Critical | **Type**: Security
- **Role**: Any
- **Steps**:
  1. Navigate to login page
  2. Enter username: "admin' OR '1'='1"
  3. Enter password: "anything"
  4. Attempt login
- **Expected Result**: 
  - Login fails
  - No SQL injection successful
  - Error handled gracefully

#### TC-SEC-02: Password Hashing Verification
**Priority**: Critical | **Type**: Security
- **Role**: Admin
- **Steps**:
  1. Create new user with password "test123"
  2. Check database directly
  3. Verify password is hashed
- **Expected Result**: 
  - Password stored as hash, not plaintext
  - Salt included in hash

#### TC-SEC-03: Unauthorized API Access
**Priority**: Critical | **Type**: Security
- **Role**: Unauthenticated user
- **Steps**:
  1. Attempt to access API endpoint without authentication
  2. Example: GET /api/products
- **Expected Result**: 
  - 401 Unauthorized response
  - No data returned
  - Redirect to login

#### TC-SEC-04: Cross-Role Permission Violation
**Priority**: Critical | **Type**: Security
- **Role**: Sales Associate
- **Steps**:
  1. Login as sales associate
  2. Attempt to access admin-only API endpoint
  3. Example: POST /api/roles
- **Expected Result**: 
  - 403 Forbidden response
  - Action not performed
  - Error logged

#### TC-SEC-05: Session Hijacking Prevention
**Priority**: High | **Type**: Security
- **Role**: Any authenticated user
- **Steps**:
  1. Login as user
  2. Copy session token
  3. Logout
  4. Attempt to use copied token
- **Expected Result**: 
  - Token invalidated on logout
  - Cannot access with old token
  - Must re-authenticate

---

### 15. Performance Test Cases

#### TC-PERF-01: Large Inventory List Loading
**Priority**: Medium | **Type**: Performance
- **Role**: Inventory Clerk
- **Steps**:
  1. Login as inventory clerk
  2. Navigate to Inventory page with 1000+ items
  3. Measure load time
- **Expected Result**: 
  - Page loads in < 3 seconds
  - Pagination implemented
  - Smooth scrolling

#### TC-PERF-02: Concurrent POS Transactions
**Priority**: High | **Type**: Performance
- **Role**: Multiple Sales Associates
- **Steps**:
  1. Simulate 5 concurrent sales
  2. All at same store
  3. Verify all complete successfully
- **Expected Result**: 
  - All sales processed
  - No inventory conflicts
  - Correct inventory deduction

#### TC-PERF-03: Search Performance
**Priority**: Medium | **Type**: Performance
- **Role**: Any user
- **Steps**:
  1. Search products with 500+ products in database
  2. Measure search response time
- **Expected Result**: 
  - Search results in < 1 second
  - Relevant results displayed
  - No timeout errors

---

### 16. UI/UX Test Cases

#### TC-UI-01: Responsive Design - Mobile View
**Priority**: Medium | **Type**: UI
- **Role**: Any user
- **Steps**:
  1. Login on mobile device
  2. Navigate through all pages
  3. Test all functions
- **Expected Result**: 
  - UI adapts to mobile screen
  - All features accessible
  - No horizontal scrolling

#### TC-UI-02: Error Message Display
**Priority**: High | **Type**: UI
- **Role**: Any user
- **Steps**:
  1. Trigger various errors (validation, permission, etc.)
  2. Observe error messages
- **Expected Result**: 
  - Clear, user-friendly error messages
  - Errors displayed prominently
  - Guidance on how to fix

#### TC-UI-03: Success Feedback
**Priority**: Medium | **Type**: UI
- **Role**: Any user
- **Steps**:
  1. Perform successful actions (create, update, delete)
  2. Observe success messages
- **Expected Result**: 
  - Success messages displayed
  - Auto-dismiss after few seconds
  - Clear confirmation of action

#### TC-UI-04: Loading States
**Priority**: Medium | **Type**: UI
- **Role**: Any user
- **Steps**:
  1. Perform actions that require server processing
  2. Observe loading indicators
- **Expected Result**: 
  - Loading spinners displayed
  - UI disabled during processing
  - Clear indication of progress

---

## Test Execution Summary Template

### Test Execution Report

**Project**: Pet Products ERP  
**Test Cycle**: [Cycle Number]  
**Date**: [Date]  
**Tester**: [Name]

| Test Case ID | Description | Role | Status | Notes |
|--------------|-------------|------|--------|-------|
| TC-AUTH-01 | System Admin Login | Admin | PASS/FAIL | |
| TC-AUTH-02 | Invalid Login | Any | PASS/FAIL | |
| ... | ... | ... | ... | ... |

**Summary**:
- Total Test Cases: [Number]
- Passed: [Number]
- Failed: [Number]
- Blocked: [Number]
- Pass Rate: [Percentage]

**Critical Issues**:
1. [Issue description]
2. [Issue description]

**Recommendations**:
1. [Recommendation]
2. [Recommendation]

---

## Test Data

### Default Test Users

| Username | Password | Role | Store Access |
|----------|----------|------|--------------|
| admin | admin123 | System Admin | All |
| regional_boss | password123 | Regional Manager | All |
| john_manager | password123 | Store Manager | Store 1 |
| sarah_manager | password123 | Store Manager | Store 2 |
| mike_sales | password123 | Sales Associate | Store 1 |
| lisa_sales | password123 | Sales Associate | Store 2 |
| david_sales | password123 | Sales Associate | Store 3 |
| anna_inventory | password123 | Inventory Clerk | Store 1, 2 |
| tom_inventory | password123 | Inventory Clerk | Store 3 |
| jane_service | password123 | Customer Service | All |
| mark_service | password123 | Customer Service | Store 1, 2 |

### Test Stores

| ID | Name | Type | Location |
|----|------|------|----------|
| 1 | Downtown Pet Store | RETAIL | Downtown |
| 2 | Suburban Pet Center | RETAIL | Suburbs |
| 3 | Mall Pet Shop | RETAIL | Shopping Mall |
| 4 | Central Warehouse | WAREHOUSE | Industrial Area |

---

## Notes for Testers

1. **Environment Setup**: Ensure database is seeded with test data before testing
2. **Test Order**: Execute test cases in order within each module
3. **Data Cleanup**: Reset test data between test cycles
4. **Browser Compatibility**: Test on Chrome, Firefox, Safari, Edge
5. **Documentation**: Document all bugs with screenshots and steps to reproduce
6. **Regression Testing**: Re-test all critical paths after bug fixes
7. **Performance Baseline**: Establish performance baselines for comparison
8. **Security Focus**: Pay special attention to permission and authentication tests

---

**Document Version**: 1.0  
**Last Updated**: December 23, 2025  
**Author**: Pet Products ERP Team
