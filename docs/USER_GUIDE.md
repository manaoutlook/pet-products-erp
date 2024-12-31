# Pet Products Distribution ERP System - User Guide

## Table of Contents
1. [System Overview](#system-overview)
2. [Getting Started](#getting-started)
3. [Navigation](#navigation)
4. [Modules](#modules)
   - [Dashboard](#dashboard)
   - [Master Data Management](#master-data-management)
   - [Products Management](#products-management)
   - [Inventory Management](#inventory-management)
   - [Purchase Order Management](#purchase-order-management)
   - [Store Operations](#store-operations)
   - [User Management](#user-management)
5. [Common Operations](#common-operations)
6. [Troubleshooting](#troubleshooting)

## System Overview

The Pet Products Distribution ERP system is a comprehensive enterprise resource planning solution specialized for pet product distribution businesses. It provides integrated management of:
- Product inventory across multiple locations
- Purchase order management with suppliers
- Store operations and performance monitoring
- User access control and permissions
- Master data management

### Key Features
- Multi-location inventory tracking
- Role-based access control
- Real-time inventory updates
- Store performance analytics (all metrics displayed in VND)
- Comprehensive product management
- Secure authentication system
- Purchase order management
- VND-based pricing and transactions

## Getting Started

### Accessing the System
1. Open your web browser and navigate to the system URL
2. You will be presented with the login screen
3. Enter your credentials:
   - Username (lowercase letters only)
   - Password
4. Click "Login" to access the system

### Username Requirements
- Usernames must be in lowercase letters only
- Minimum length: 3 characters
- The system automatically converts all usernames to lowercase
- No special characters or numbers allowed in usernames
- Examples of valid usernames: admin, storemanager, inventoryuser
- Examples of invalid usernames: Admin123, store.manager, inventory_user

### First-time Setup
- Default admin credentials:
  - Username: admin
  - Password: admin123
- It's recommended to change the default password after first login
- System administrators can create additional user accounts
- All new usernames will be automatically converted to lowercase

### Security Best Practices
1. Password Management
   - Use strong passwords with a mix of characters
   - Change passwords regularly
   - Never share login credentials

2. Session Management
   - Always log out when finished
   - Don't use shared computers for access
   - Clear browser cache after using public computers

## Navigation

### Main Navigation Menu
The system uses a hierarchical navigation structure located in the left sidebar, organized into the following main sections:

1. **Dashboard**
   - Overview of key metrics and activities
   - Quick access to common functions
   - Revenue metrics in VND
2. **Master Data**
   - Categories
   - Brands
   - Suppliers (for purchase order management)
3. **Products**
   - Product List
   - Product Management (prices in VND)
4. **Orders**
   - Purchase Order Management (supplier orders)
   - Order History
   - Performance Tracking
5. **Inventory**
   - Stock Management
   - Stock Transfers
   - Inventory Reports
   - Purchase Order Management (supplier orders)

### User Interface Elements
- **Collapsible Sidebar**: Click menu items with arrows to expand/collapse sub-menus
- **User Profile**: Located at the bottom of sidebar, showing current user and role
- **Logout**: Available in the user profile section

## Modules

### Dashboard
The dashboard provides an overview of:
- Recent orders
- Low stock alerts
- Key performance indicators
- Quick access to common tasks

### Master Data Management

#### Categories
- View all product categories
- Add new categories
- Edit existing categories
- Delete unused categories

#### Brands
- Manage product brands
- Add new brands
- Edit brand information
- View brand-wise products

#### Suppliers
- Maintain supplier directory
- Add new suppliers
- Update supplier information
- View supplier-wise inventory

### Products Management

#### Product List
- Comprehensive product catalog
- Filter and search products
- View product details
- Manage product information

#### Adding New Products
1. Click "Add Product" button
2. Fill in required details:
   - Product name
   - SKU
   - Category
   - Brand
   - Price (in VND)
   - Description
   - Minimum stock level
3. Save the product

### Inventory Management

#### Stock Management
- View current stock levels
- Monitor stock across locations
- Track inventory movements
- Set minimum stock alerts

#### Adding Inventory
1. Click "Add Inventory" button
2. Select:
   - Product
   - Location (DC/Store)
   - Quantity
   - Supplier
   - Batch/Lot number (if applicable)
3. Submit inventory entry

#### Stock Transfer Process
1. Initiate Transfer
   - Select source location
   - Choose destination location
   - Enter transfer date

2. Add Products
   - Select products to transfer
   - Specify quantities
   - Check available stock

3. Verify and Submit
   - Review transfer details
   - Add any notes or references
   - Submit for processing

4. Track Transfer
   - Monitor transfer status
   - Confirm receipt at destination
   - View transfer history

#### Inventory Adjustments
1. Types of Adjustments
   - Stock count reconciliation
   - Damage/loss recording
   - Returns processing
   - Expiry write-offs

2. Adjustment Process
   - Select adjustment type
   - Choose affected products
   - Enter adjustment quantities
   - Provide reason and documentation
   - Submit for approval

#### Purchase Orders (Supplier Orders)
1. Creating Purchase Orders
   - Select supplier from master data
   - Choose products to order
   - Set quantities based on:
     * Current stock levels
     * Minimum stock requirements
   - Specify delivery location
   - Enter pricing in VND
   - Add any supplier-specific notes

2. Purchase Order Approval
   - Review order details
   - Check budget allocation in VND
   - Verify supplier terms
   - Submit for approval based on amount thresholds

3. Order Tracking
   - Monitor order status
   - Track shipment details
   - Record partial deliveries
   - Handle supplier communications
   - Update inventory values in VND

### Purchase Order Management

The Purchase Order Management module helps you efficiently manage your purchase orders and track order quantities with suppliers.

#### Key Fields in Purchase Orders
- **Purchase Order ID**: A unique identifier for each purchase order
- **Supplier Name**: The name of the supplier from whom you are ordering products
- **Product ID**: A unique identifier for each product being ordered
- **Product Name**: The name of the product being ordered
- **Quantity Ordered**: The number of units ordered for each product
- **Order Date**: The date when the order was placed
- **Delivery Date**: The expected date for the order to be delivered
- **Status**: Current status of the order (e.g., "Pending", "Confirmed", "Delivered")
- **Amount**: All amounts are in VND

#### Creating Purchase Orders
1. Navigate to Purchase Orders section
2. Click "Create New Purchase Order"
3. Select supplier from the master data
4. Add products:
   - Search and select products
   - Specify quantities
   - System automatically shows prices in VND
5. Set delivery date
6. Review and submit order

#### Managing Purchase Orders
1. View Orders
   - List of all purchase orders
   - Filter by status, date, or supplier
   - Sort by various fields

2. Track Status
   - Monitor order progress
   - Update order status
   - View order history

3. Receive Orders
   - Record deliveries
   - Partial deliveries allowed
   - System automatically updates inventory when status changes to "Delivered"

4. Reports
   - Purchase order summary
   - Supplier performance
   - Order status reports
   - All financial reports in VND

#### Important Notes
- Once an order status is changed to "Delivered", the inventory quantity will automatically update in the Inventory module
- All monetary values are displayed and calculated in VND
- The system maintains a complete audit trail of all purchase order activities
- Notifications are sent for important status changes


### Store Operations

#### Store Setup and Configuration
1. Basic Information
   - Store name
   - Location details
   - Contact information
   - Operating hours

2. Inventory Settings
   - Set minimum stock levels
   - Configure reorder points
   - Define stock transfer rules

3. User Assignment
   - Assign store managers
   - Set up store staff
   - Configure access permissions

#### Store Performance Monitoring
1. Key Metrics
   - Daily sales (in VND)
   - Inventory turnover
   - Order fulfillment rate

2. Reports
   - Sales analysis (in VND)
   - Stock movement
   - Staff performance
   - Profit margins (in VND)


### User Management

#### Users
- Create new users
  - Usernames must be in lowercase letters
  - Usernames must be at least 3 characters long
  - System automatically converts usernames to lowercase
- Assign roles
- Update user information
- Reset passwords

#### Roles and Permissions
1. Role Types
   - System Administrator
   - Store Manager
   - Inventory Manager
   - Sales Staff
   - Warehouse Staff

2. Permission Levels
   - Create: Add new records
   - Read: View existing records
   - Update: Modify existing records
   - Delete: Remove records

3. Permission Areas
   - Products management
   - Inventory control
   - Purchase order processing
   - User administration
   - Store operations

#### Store Assignments
1. Assignment Process
   - Select user
   - Choose store location
   - Set assignment period
   - Define responsibilities

2. Access Control
   - Store-specific permissions
   - Inventory access levels
   - Purchase order management rights
   - Report access

## Common Operations

### Password Management
1. Navigate to User Management
2. Select user account
3. Click "Reset Password"
4. Enter new password
5. Save changes

### Inventory Operations
1. Stock Transfer
   - Select source location
   - Choose destination
   - Specify products and quantities
   - Complete transfer

2. Stock Adjustment
   - Select product
   - Enter adjustment quantity
   - Provide reason
   - Submit adjustment

### Reports Generation
1. Navigate to desired module
2. Click "Generate Report"
3. Select parameters:
   - Date range
   - Categories
   - Locations
4. Choose report format
5. Download report

## Troubleshooting

### Common Issues and Solutions

1. **Login Issues**
   - Verify username (remember it's case-insensitive and always lowercase)
   - Check Caps Lock status
   - Contact administrator for password reset

2. **Access Denied**
   - Verify role permissions
   - Check store assignments
   - Contact administrator for access

3. **Inventory Discrepancies**
   - Review recent transactions
   - Check transfer records
   - Perform physical count
   - Contact supervisor for resolution

### Support Contact
For technical support:
1. Contact your system administrator
2. Document the issue with screenshots if possible
3. Note any error messages
4. Describe the steps to reproduce the issue

### Best Practices
1. Regular password updates
2. Log out after each session
3. Verify transactions before submission
4. Regular data backup and verification
5. Keep master data updated

---

This documentation is maintained and updated regularly. For the latest version, please check with your system administrator.