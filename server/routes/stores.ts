import type { Express } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { stores, invoiceCounters, insertStoreSchema } from "@db/schema";
import { requireAuth, requirePermission } from "../middleware";
import { validateBody, validateParams, idParamSchema } from "../validate";
import { getStoreDeletionBlockers, hasBlockers, buildStoreDeletionError } from "../store-deletion";
import { initializeStoreCounter } from "../invoice-counter";

/**
 * Store endpoints.
 *
 * First slice of the routes.ts split (backlog P2 #9): routes.ts was 5,210 lines and every
 * domain shared one scope, so a change to stores forced a read of the whole file. Each
 * domain gets its own module and a `register…Routes(app)` function; `registerRoutes` just
 * calls them in order.
 *
 * Behaviour is unchanged - the handlers below were moved verbatim, including the
 * permission middleware that the now-deleted duplicate registrations never reached.
 */
export function registerStoreRoutes(app: Express) {
  // Store Management endpoints
  app.get("/api/stores", requireAuth, async (req, res) => {
    try {
      const allStores = await db.query.stores.findMany({
        orderBy: [desc(stores.updatedAt)],
      });
      res.json(allStores);
    } catch (error) {
      console.error('Error fetching stores:', error);
      res.status(500).json({
        message: "Failed to fetch stores",
        suggestion: "Please try again later"
      });
    }
  });

  app.post("/api/stores", requirePermission('stores', 'create'), validateBody(insertStoreSchema, "Provide the store name, location and region"), async (req, res) => {
    try {
      const { name, location, contactInfo, type, regionId } = req.body; // AI Agent Note: Added 'type' and 'regionId'

      // AI Agent Note: A store must belong to a region for hierarchical access
      // control. Without this, region_id was silently stored as NULL for every
      // store created through the UI.
      if (regionId == null) {
        return res.status(400).json({
          message: "Region is required",
          errors: [{ field: "regionId", message: "Region is required" }],
        });
      }

      // Check if store exists
      const existingStore = await db.query.stores.findFirst({
        where: eq(stores.name, name),
      });

      if (existingStore) {
        return res.status(400).json({
          message: "Store with this name already exists",
          suggestion: "Please use a different store name"
        });
      }

      const [newStore] = await db
        .insert(stores)
        .values({
          name,
          location,
          contactInfo,
          regionId,
          type: type || 'RETAIL', // AI Agent Note: Save store type
        })
        .returning();

      // Initialize invoice counter for the new store
      try {
        await initializeStoreCounter(newStore.id);
      } catch (counterError) {
        console.error('Failed to initialize invoice counter for store:', newStore.id, counterError);
        // Don't fail the store creation if counter initialization fails
      }

      res.json({
        message: "Store created successfully",
        store: newStore,
      });
    } catch (error) {
      console.error('Error creating store:', error);
      res.status(500).json({
        message: "Failed to create store",
        suggestion: "Please try again later"
      });
    }
  });

  app.put("/api/stores/:id", requirePermission('stores', 'update'), validateParams(idParamSchema, "Use a numeric store id"), validateBody(insertStoreSchema, "Provide the store name, location and region"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, location, contactInfo, type, regionId } = req.body; // AI Agent Note: Added 'type' and 'regionId'

      // AI Agent Note: A store must belong to a region for hierarchical access
      // control. Reject updates that would leave region_id NULL.
      if (regionId == null) {
        return res.status(400).json({
          message: "Region is required",
          errors: [{ field: "regionId", message: "Region is required" }],
        });
      }

      // Check if store exists
      const existingStore = await db.query.stores.findFirst({
        where: and(
          eq(stores.name, name),
          sql`id != ${id}`
        ),
      });

      if (existingStore) {
        return res.status(400).json({
          message: "Store with this name already exists",
          suggestion: "Please use a different store name"
        });
      }

      const [updatedStore] = await db
        .update(stores)
        .set({
          name,
          location,
          contactInfo,
          regionId,
          type: type || 'RETAIL', // AI Agent Note: Save store type
          updatedAt: new Date()
        })
        .where(eq(stores.id, parseInt(id)))
        .returning();

      if (!updatedStore) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      res.json({
        message: "Store updated successfully",
        store: updatedStore,
      });
    } catch (error) {
      console.error('Error updating store:', error);
      res.status(500).json({
        message: "Failed to update store",
        suggestion: "Please try again later"
      });
    }
  });

  app.delete("/api/stores/:id", requirePermission('stores', 'delete'), validateParams(idParamSchema, "Please select a store and try again"), async (req, res) => {
    const storeId = Number(req.params.id);

    try {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, storeId),
      });

      if (!store) {
        return res.status(404).json({
          message: "Store not found",
          suggestion: "Please verify the store ID"
        });
      }

      // AI Agent Note: A store is referenced by operational data (inventory,
      // user assignments) and immutable history (sales, purchase orders,
      // transfers). Every referencing table is checked explicitly in
      // getStoreDeletionBlockers because a missed check surfaces either as an
      // opaque Postgres FK error (23503) or, worse, as silently orphaned rows
      // (inventory can be linked by the free-text `location` column, which has no
      // foreign key).
      const blockers = await getStoreDeletionBlockers(storeId, store.location);

      if (hasBlockers(blockers)) {
        return res.status(400).json(buildStoreDeletionError(store.name, store.location, blockers));
      }

      await db.transaction(async (tx) => {
        // AI Agent Note: Invoice counters hold numbering state only (no business
        // history), so they are removed together with the store.
        await tx.delete(invoiceCounters).where(eq(invoiceCounters.storeId, storeId));
        await tx.delete(stores).where(eq(stores.id, storeId));
      });

      res.json({
        message: "Store deleted successfully"
      });
    } catch (error) {
      console.error('Error deleting store:', error);

      // AI Agent Note: Postgres FK violation (23503) means some other record still
      // references this store - report it as a client error, not a server failure.
      const pgError = error as { code?: string };
      if (pgError?.code === '23503') {
        return res.status(400).json({
          message: "Cannot delete this store because other records still reference it",
          suggestion: "Please remove all inventory, user assignments and related transactions for this store first"
        });
      }

      res.status(500).json({
        message: "Failed to delete store",
        suggestion: "Please try again later"
      });
    }
  });
}

export default registerStoreRoutes;
