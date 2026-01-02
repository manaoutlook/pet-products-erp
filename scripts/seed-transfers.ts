#!/usr/bin/env tsx

import "dotenv/config";
import { db } from "../db/index.js";
import { transferRequests, transferRequestItems, transferActions, transferHistory } from "../db/schema.js";

async function seedTransfers() {
    console.log("🚚 Seeding inter-store transfer requests...");

    try {
        // Generate unique transfer number
        function generateTransferNumber(): string {
            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            return `TRF-${year}${month}-${randomNum}`;
        }

        const transferRequestData = [
            // Recent pending transfers
            {
                transferNumber: generateTransferNumber(),
                fromStoreId: 1, // Downtown Store
                toStoreId: 2, // Uptown Store
                requestedByUserId: 1, // john_manager
                status: 'pending',
                priority: 'high',
                notes: 'Urgent transfer for high-demand products'
            },
            {
                transferNumber: generateTransferNumber(),
                fromStoreId: 2, // Uptown Store
                toStoreId: 3, // Mall Store
                requestedByUserId: 2, // sarah_manager
                status: 'approved',
                priority: 'normal',
                notes: 'Regular stock balancing'
            },
            {
                transferNumber: generateTransferNumber(),
                fromStoreId: 3, // Mall Store
                toStoreId: 1, // Downtown Store
                requestedByUserId: 3, // mike_manager
                status: 'completed',
                priority: 'normal',
                notes: 'Completed transfer from last week'
            },
            {
                transferNumber: generateTransferNumber(),
                fromStoreId: 1, // Downtown Store
                toStoreId: 3, // Mall Store
                requestedByUserId: 4, // lisa_sales
                status: 'in_transit',
                priority: 'low',
                notes: 'Mall store restocking'
            },
            {
                transferNumber: generateTransferNumber(),
                fromStoreId: 3, // Mall Store
                toStoreId: 2, // Suburban Store
                requestedByUserId: 5, // david_sales
                status: 'cancelled',
                priority: 'normal',
                notes: 'Cancelled due to inventory changes'
            }
        ];

        console.log("📋 Creating transfer requests...");
        const createdTransfers = [];
        for (const transfer of transferRequestData) {
            const result = await db.insert(transferRequests).values(transfer).returning();
            createdTransfers.push(result[0]);
            console.log(`✓ Created transfer ${transfer.transferNumber} (${transfer.status}) - ${transfer.priority} priority`);
        }

        // Create transfer request items
        console.log("\n📦 Creating transfer request items...");

        const transferItemsData = [
            // Transfer 1 items - Pending (Downtown to Uptown)
            { transferRequestId: createdTransfers[0].id, productId: 3, requestedQuantity: 5, approvedQuantity: null, transferredQuantity: 0 },
            { transferRequestId: createdTransfers[0].id, productId: 4, requestedQuantity: 3, approvedQuantity: null, transferredQuantity: 0 },

            // Transfer 2 items - Approved (Uptown to Mall)
            { transferRequestId: createdTransfers[1].id, productId: 10, requestedQuantity: 10, approvedQuantity: 8, transferredQuantity: 0 },
            { transferRequestId: createdTransfers[1].id, productId: 11, requestedQuantity: 6, approvedQuantity: 6, transferredQuantity: 0 },
            { transferRequestId: createdTransfers[1].id, productId: 14, requestedQuantity: 15, approvedQuantity: 12, transferredQuantity: 0 },

            // Transfer 3 items - Completed (Mall to Downtown)
            { transferRequestId: createdTransfers[2].id, productId: 5, requestedQuantity: 4, approvedQuantity: 4, transferredQuantity: 4 },
            { transferRequestId: createdTransfers[2].id, productId: 15, requestedQuantity: 8, approvedQuantity: 8, transferredQuantity: 8 },
            { transferRequestId: createdTransfers[2].id, productId: 16, requestedQuantity: 12, approvedQuantity: 10, transferredQuantity: 10 },

            // Transfer 4 items - In Transit (Downtown to Airport)
            { transferRequestId: createdTransfers[3].id, productId: 6, requestedQuantity: 6, approvedQuantity: 6, transferredQuantity: 6 },
            { transferRequestId: createdTransfers[3].id, productId: 17, requestedQuantity: 20, approvedQuantity: 15, transferredQuantity: 15 },

            // Transfer 5 items - Cancelled (Airport to Uptown)
            { transferRequestId: createdTransfers[4].id, productId: 18, requestedQuantity: 8, approvedQuantity: null, transferredQuantity: 0 },
            { transferRequestId: createdTransfers[4].id, productId: 19, requestedQuantity: 5, approvedQuantity: null, transferredQuantity: 0 }
        ];

        const createdItems = [];
        for (const item of transferItemsData) {
            const result = await db.insert(transferRequestItems).values(item).returning();
            createdItems.push(result[0]);
        }
        console.log(`✓ Created ${createdItems.length} transfer request items`);

        // Create transfer actions
        console.log("\n⚡ Creating transfer actions...");

        const actionsData = [
            // Transfer 1 actions - Pending
            {
                transferRequestId: createdTransfers[0].id,
                actionType: 'request_created',
                actionData: { notes: 'High priority transfer request submitted' },
                performedByUserId: 1, // john_manager
                performedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
            },

            // Transfer 2 actions - Approved
            {
                transferRequestId: createdTransfers[1].id,
                actionType: 'request_created',
                actionData: { notes: 'Regular stock balancing request' },
                performedByUserId: 2, // sarah_manager
                performedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
            },
            {
                transferRequestId: createdTransfers[1].id,
                actionType: 'approved',
                actionData: { notes: 'Approved with partial quantities' },
                performedByUserId: 10, // regional_boss
                performedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
            },

            // Transfer 3 actions - Completed
            {
                transferRequestId: createdTransfers[2].id,
                actionType: 'request_created',
                actionData: { notes: 'Weekly stock transfer' },
                performedByUserId: 3, // mike_manager
                performedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
            },
            {
                transferRequestId: createdTransfers[2].id,
                actionType: 'approved',
                actionData: { notes: 'Approved for transfer' },
                performedByUserId: 10, // regional_boss
                performedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)
            },
            {
                transferRequestId: createdTransfers[2].id,
                actionType: 'completed',
                actionData: { notes: 'Transfer completed successfully' },
                performedByUserId: 6, // anna_inventory
                performedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            },

            // Transfer 4 actions - In Transit
            {
                transferRequestId: createdTransfers[3].id,
                actionType: 'request_created',
                actionData: { notes: 'Airport store restocking' },
                performedByUserId: 4, // lisa_manager
                performedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
            },
            {
                transferRequestId: createdTransfers[3].id,
                actionType: 'approved',
                actionData: { notes: 'Approved for airport delivery' },
                performedByUserId: 10, // regional_boss
                performedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
            },
            {
                transferRequestId: createdTransfers[3].id,
                actionType: 'shipped',
                actionData: { notes: 'Items picked and shipped' },
                performedByUserId: 7, // tom_inventory
                performedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
            },

            // Transfer 5 actions - Cancelled
            {
                transferRequestId: createdTransfers[4].id,
                actionType: 'request_created',
                actionData: { notes: 'Return transfer request' },
                performedByUserId: 5, // david_manager
                performedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
            },
            {
                transferRequestId: createdTransfers[4].id,
                actionType: 'cancelled',
                actionData: { notes: 'Cancelled due to inventory priority changes' },
                performedByUserId: 10, // regional_boss
                performedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
            }
        ];

        const createdActions = [];
        for (const action of actionsData) {
            const result = await db.insert(transferActions).values(action).returning();
            createdActions.push(result[0]);
        }
        console.log(`✓ Created ${createdActions.length} transfer actions`);

        // Create transfer history for completed transfers
        console.log("\n📚 Creating transfer history...");

        const historyData = [
            // Transfer 3 history - Completed transfer
            {
                transferRequestId: createdTransfers[2].id,
                fromInventoryId: 15, // Some inventory record
                toInventoryId: 8, // Different inventory record
                productId: 3,
                quantity: 4,
                transferredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                transferredByUserId: 6, // anna_inventory
                notes: 'Breed specific nutrition transfer'
            },
            {
                transferRequestId: createdTransfers[2].id,
                fromInventoryId: 16,
                toInventoryId: 9,
                productId: 15,
                quantity: 8,
                transferredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                transferredByUserId: 6,
                notes: 'Puzzle toys transfer'
            },
            {
                transferRequestId: createdTransfers[2].id,
                fromInventoryId: 17,
                toInventoryId: 10,
                productId: 16,
                quantity: 10,
                transferredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                transferredByUserId: 6,
                notes: 'Cat wand toys transfer'
            }
        ];

        const createdHistory = [];
        for (const history of historyData) {
            const result = await db.insert(transferHistory).values(history).returning();
            createdHistory.push(result[0]);
        }
        console.log(`✓ Created ${createdHistory.length} transfer history records`);

        console.log("\n✅ Transfer requests seeding completed!");
        console.log("\n📊 Summary:");
        console.log(`- ${createdTransfers.length} transfer requests created`);
        console.log(`- ${createdItems.length} transfer request items created`);
        console.log(`- ${createdActions.length} transfer actions created`);
        console.log(`- ${createdHistory.length} transfer history records created`);

        console.log("\n📋 Transfer Status Distribution:");
        const statusCounts = createdTransfers.reduce((acc, transfer) => {
            acc[transfer.status] = (acc[transfer.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`  • ${status}: ${count} transfers`);
        });

    } catch (error) {
        console.error("❌ Error seeding transfer requests:", error);
        process.exit(1);
    }

    process.exit(0);
}

seedTransfers();
