#!/usr/bin/env tsx

import "dotenv/config";
import { db } from "../db/index.js";
import { orders, orderItems } from "../db/schema.js";

async function seedOrders() {
    console.log("🛒 Seeding customer orders...");

    try {
        // Generate unique order data
        const orderData = [
            {
                customerName: "Nguyen Van A",
                customerEmail: "nguyenvana@email.com",
                status: 'completed',
                storeId: 1, // Downtown Store
                total: "2500000.00", // VND
                customerProfileId: 1
            },
            {
                customerName: "Tran Thi B",
                customerEmail: "tranthib@email.com",
                status: 'completed',
                storeId: 2, // Uptown Store
                total: "1800000.00",
                customerProfileId: 2
            },
            {
                customerName: "Le Van C",
                customerEmail: "levanc@email.com",
                status: 'pending',
                storeId: 1, // Downtown Store
                total: "3200000.00",
                customerProfileId: 3
            },
            {
                customerName: "Pham Thi D",
                customerEmail: "phamthid@email.com",
                status: 'completed',
                storeId: 3, // Mall Store
                total: "950000.00",
                customerProfileId: 4
            },
            {
                customerName: "Hoang Van E",
                customerEmail: "hoangvane@email.com",
                status: 'processing',
                storeId: 2, // Uptown Store
                total: "4100000.00",
                customerProfileId: 5
            }
        ];

        console.log("📝 Creating customer orders...");
        const createdOrders = [];
        for (const order of orderData) {
            const result = await db.insert(orders).values(order).returning();
            createdOrders.push(result[0]);
            console.log(`✓ Created order for ${order.customerName} - ${order.total} VND (${order.status})`);
        }

        // Create order items
        console.log("\n📦 Creating order items...");

        const orderItemsData = [
            // Order 1 items
            { orderId: createdOrders[0].id, productId: 3, quantity: 2, price: "1250000.00", total: "2500000.00" },

            // Order 2 items
            { orderId: createdOrders[1].id, productId: 10, quantity: 1, price: "650000.00", total: "650000.00" },
            { orderId: createdOrders[1].id, productId: 14, quantity: 3, price: "150000.00", total: "450000.00" },
            { orderId: createdOrders[1].id, productId: 17, quantity: 1, price: "200000.00", total: "200000.00" },
            { orderId: createdOrders[1].id, productId: 18, quantity: 2, price: "350000.00", total: "700000.00" },

            // Order 3 items
            { orderId: createdOrders[2].id, productId: 4, quantity: 1, price: "1350000.00", total: "1350000.00" },
            { orderId: createdOrders[2].id, productId: 5, quantity: 1, price: "1450000.00", total: "1450000.00" },
            { orderId: createdOrders[2].id, productId: 15, quantity: 1, price: "250000.00", total: "250000.00" },
            { orderId: createdOrders[2].id, productId: 19, quantity: 1, price: "450000.00", total: "450000.00" },

            // Order 4 items
            { orderId: createdOrders[3].id, productId: 11, quantity: 1, price: "700000.00", total: "700000.00" },
            { orderId: createdOrders[3].id, productId: 16, quantity: 1, price: "120000.00", total: "120000.00" },
            { orderId: createdOrders[3].id, productId: 17, quantity: 1, price: "200000.00", total: "200000.00" },

            // Order 5 items
            { orderId: createdOrders[4].id, productId: 6, quantity: 2, price: "1300000.00", total: "2600000.00" },
            { orderId: createdOrders[4].id, productId: 12, quantity: 1, price: "1200000.00", total: "1200000.00" },
            { orderId: createdOrders[4].id, productId: 20, quantity: 1, price: "280000.00", total: "280000.00" }
        ];

        const createdItems = [];
        for (const item of orderItemsData) {
            const result = await db.insert(orderItems).values(item).returning();
            createdItems.push(result[0]);
        }
        console.log(`✓ Created ${createdItems.length} order items`);

        console.log("\n✅ Customer orders seeding completed!");
        console.log("\n📊 Summary:");
        console.log(`- ${createdOrders.length} customer orders created`);
        console.log(`- ${createdItems.length} order items created`);

        console.log("\n📋 Order Status Distribution:");
        const statusCounts = createdOrders.reduce((acc, order) => {
            acc[order.status] = (acc[order.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`  • ${status}: ${count} orders`);
        });

    } catch (error) {
        console.error("❌ Error seeding customer orders:", error);
        process.exit(1);
    }

    process.exit(0);
}

seedOrders();
