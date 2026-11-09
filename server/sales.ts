import { db } from "@db";
import {
  inventory,
  products,
  salesTransactionActions,
  salesTransactionItems,
  salesTransactions,
  userStoreAssignments,
} from "@db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { generateInvoiceNumber } from "./invoice-counter";
import { applyStockChange, recordStockMovements } from "./stock-ledger";

export interface SaleItemInput {
  productId: number;
  quantity: number;
}

export interface CreateSaleInput {
  userId: number;
  items: SaleItemInput[];
  paymentMethod: string;
  customerProfileId?: number | null;
  transactionType?: 'STORE_SALE' | 'DC_SALE';
}

/**
 * A client-correctable failure inside a sale/refund/cancel.
 * Routes map it to res.status(err.status).json({ message, suggestion }).
 */
export class SaleError extends Error {
  status: number;
  suggestion?: string;

  constructor(message: string, status = 400, suggestion?: string) {
    super(message);
    this.name = 'SaleError';
    this.status = status;
    this.suggestion = suggestion;
  }
}

function toPrice(value: string | number | null | undefined): number {
  return typeof value === 'string' ? parseFloat(value) : Number(value);
}

/**
 * Shape declared for `sales_transaction_actions.action_data` in the schema.
 *
 * AI Agent Note: the column is typed narrowly ({ notes, refundAmount, reference }) while the
 * audit trail deliberately records a richer payload per action (item count, total, reason,
 * cancelledBy, ...). Keep the cast in one place instead of loosening the schema, so the rest of
 * this module stays type-checked.
 */
type SaleActionData = { notes?: string; refundAmount?: number; reference?: string };

function actionData(payload: Record<string, unknown>): SaleActionData {
  return payload as unknown as SaleActionData;
}

export async function createSale(input: CreateSaleInput) {
  const { userId, items, paymentMethod, customerProfileId = null } = input;
  const transactionType: 'STORE_SALE' | 'DC_SALE' =
    input.transactionType === 'DC_SALE' ? 'DC_SALE' : 'STORE_SALE';

  if (!Array.isArray(items) || items.length === 0) {
    throw new SaleError('At least one item is required', 400, 'Add products to the transaction');
  }
  if (!paymentMethod) {
    throw new SaleError('Payment method is required', 400);
  }

  // Store resolution stays outside the transaction: it is one read of static
  // assignment data and only decides which inventory rows the sale will touch.
  let storeId: number | null = null;
  if (transactionType === 'STORE_SALE') {
    const assignment = await db.query.userStoreAssignments.findFirst({
      where: eq(userStoreAssignments.userId, userId),
    });
    if (!assignment) {
      throw new SaleError('User is not assigned to any store', 403,
        'Contact administrator to assign you to a store');
    }
    storeId = assignment.storeId;
  }

  // Merge duplicate product ids: the same product twice in one cart must consume one
  // combined quantity, otherwise the stock guard below is evaluated per line.
  const merged = new Map<number, number>();
  for (const raw of items) {
    const productId = Number(raw?.productId);
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(productId) || productId <= 0 ||
        !Number.isInteger(quantity) || quantity <= 0) {
      throw new SaleError('Invalid item data', 400,
        'Each item must have productId and positive quantity');
    }
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }

  const saleId = await db.transaction(async (tx) => {
    const invoiceNumber = await generateInvoiceNumber(storeId, transactionType, tx);

    const pricedItems: Array<{
      productId: number; inventoryId: number; quantity: number;
      unitPrice: number; totalPrice: number;
      /** Stock right before/after this line, so the ledger row can show "12 → 10". */
      quantityBefore: number; quantityAfter: number;
    }> = [];

    for (const [productId, quantity] of Array.from(merged.entries())) {
      const stockRow = await tx.query.inventory.findFirst({
        where: and(
          eq(inventory.productId, productId),
          storeId ? eq(inventory.storeId, storeId) : eq(inventory.inventoryType, 'DC'),
        ),
        with: { product: true },
      });

      if (!stockRow) {
        const product = await tx.query.products.findFirst({ where: eq(products.id, productId) });
        throw new SaleError(
          `Product ${product?.name || 'Unknown'} is not available in ${storeId ? 'your store' : 'DC'}`,
          400,
          'Choose a different product or check inventory',
        );
      }

      // `with: { product: true }` widens the relation to a union drizzle cannot narrow on its
      // own, so pin the result type back to the product row before reading `price` / `name`.
      const product: typeof products.$inferSelect | undefined =
        (stockRow.product as typeof products.$inferSelect | null) ??
        (await tx.query.products.findFirst({ where: eq(products.id, productId) }));
      if (!product) {
        throw new SaleError(`Product with ID ${productId} not found`, 400,
          'Please verify the product exists');
      }

      const unitPrice = toPrice(product.price);
      if (!unitPrice || Number.isNaN(unitPrice)) {
        throw new SaleError('Unable to determine product price', 400,
          'Please contact support - product may not be properly configured');
      }

      // Conditional decrement - the WHERE clause is the concurrency guard.
      const [deducted] = await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${quantity}`, updatedAt: new Date() })
        .where(and(eq(inventory.id, stockRow.id), gte(inventory.quantity, quantity)))
        .returning({ id: inventory.id, quantity: inventory.quantity });

      if (!deducted) {
        throw new SaleError(
          `Insufficient stock for ${product.name}. Available: ${stockRow.quantity}, Requested: ${quantity}`,
          400,
          'Reduce quantity or choose a different product',
        );
      }

      pricedItems.push({
        productId,
        inventoryId: stockRow.id,
        quantity,
        unitPrice,
        totalPrice: unitPrice * quantity,
        // RETURNING gives the post-decrement value from the same statement, so the pair is
        // correct even when another till sells the same row concurrently.
        quantityAfter: deducted.quantity,
        quantityBefore: deducted.quantity + quantity,
      });
    }

    const totalAmount = pricedItems.reduce((sum, item) => sum + item.totalPrice, 0);

    const [salesTransaction] = await tx
      .insert(salesTransactions)
      .values({
        invoiceNumber,
        storeId,
        transactionType,
        cashierUserId: userId,
        customerProfileId: customerProfileId || null,
        totalAmount: totalAmount.toString(),
        paymentMethod,
        status: 'completed',
      })
      .returning({ id: salesTransactions.id });

    await tx.insert(salesTransactionItems).values(
      pricedItems.map((item) => ({
        salesTransactionId: salesTransaction.id,
        productId: item.productId,
        inventoryId: item.inventoryId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        totalPrice: item.totalPrice.toString(),
      })),
    );

    await tx.insert(salesTransactionActions).values({
      salesTransactionId: salesTransaction.id,
      actionType: 'sale_completed',
      actionData: actionData({ itemsCount: pricedItems.length, totalAmount }),
      performedByUserId: userId,
    });

    // Ledger rows are written here, not at the deduct step, because the sale id only
    // exists now - and a movement must point at the document that caused it.
    await recordStockMovements(tx, pricedItems.map((item) => ({
      inventoryId: item.inventoryId,
      productId: item.productId,
      storeId,
      delta: -item.quantity,
      reason: 'sale' as const,
      transactionType: 'SALES_ORDER' as const,
      quantityBefore: item.quantityBefore,
      quantityAfter: item.quantityAfter,
      refType: 'sales_transaction',
      refId: salesTransaction.id,
      userId,
    })));

    return salesTransaction.id;
  });

  // Re-read after commit so the response keeps the shape the client already expects
  // (relations: items/products/inventory/store/cashier/customer).
  return db.query.salesTransactions.findFirst({
    where: eq(salesTransactions.id, saleId),
    with: {
      items: { with: { product: true, inventory: true } },
      store: true,
      cashierUser: true,
      customerProfile: true,
    },
  });
}

export interface RefundItemInput {
  id: number;
  quantity: number;
}

export interface RefundSaleInput {
  transactionId: number;
  userId: number;
  refundAmount?: number | string;
  reason?: string;
  items?: RefundItemInput[];
}

export async function refundSale(input: RefundSaleInput) {
  const { transactionId, userId, refundAmount, reason, items } = input;

  return db.transaction(async (tx) => {
    const transaction = await tx.query.salesTransactions.findFirst({
      where: eq(salesTransactions.id, transactionId),
      with: { items: { with: { product: true } } },
    });

    if (!transaction) {
      throw new SaleError('Sales transaction not found', 404, 'Verify the transaction ID');
    }
    if (transaction.status === 'refunded') {
      throw new SaleError('Transaction has already been refunded',
        400, 'Cannot refund an already refunded transaction');
    }
    if (transaction.status === 'voided' || transaction.status === 'cancelled') {
      throw new SaleError('Cannot refund a voided or cancelled transaction',
        400, 'Voided or cancelled transactions cannot be refunded');
    }
    if (transaction.status !== 'completed') {
      throw new SaleError(`Cannot refund a transaction in status "${transaction.status}"`,
        400, 'Only completed transactions can be refunded');
    }

    const transactionTotal = parseFloat(transaction.totalAmount);
    const requestedRefund = refundAmount !== undefined && refundAmount !== null
      ? parseFloat(String(refundAmount))
      : transactionTotal;

    if (Number.isNaN(requestedRefund) || requestedRefund <= 0) {
      throw new SaleError('Refund amount must be greater than zero');
    }
    if (requestedRefund > transactionTotal) {
      throw new SaleError('Refund amount cannot exceed transaction total',
        400, `Maximum refund amount is ${transactionTotal}`);
    }

    // Resolve which inventory rows (and how many units) go back into stock.
    // productId is carried along so the ledger row can be denormalised.
    const restore = new Map<number, { quantity: number; productId: number | null }>();
    const addToRestore = (inventoryId: number, quantity: number, productId: number | null) => {
      const current = restore.get(inventoryId);
      restore.set(inventoryId, {
        quantity: (current?.quantity ?? 0) + quantity,
        productId: current?.productId ?? productId,
      });
    };

    if (items && Array.isArray(items) && items.length > 0) {
      for (const refundItem of items) {
        const transactionItem = transaction.items.find((item) => item.id === refundItem.id);
        if (!transactionItem) {
          throw new SaleError(`Transaction item ${refundItem.id} not found`,
            400, 'Verify the item IDs to refund');
        }
        const quantity = Number(refundItem.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new SaleError('Refund quantity must be a positive whole number',
            400, 'Verify the quantities to refund');
        }
        if (quantity > transactionItem.quantity) {
          throw new SaleError(
            `Refund quantity for ${transactionItem.product?.name ?? 'item'} cannot exceed sold quantity`,
            400, `Maximum refund quantity is ${transactionItem.quantity}`,
          );
        }
        addToRestore(transactionItem.inventoryId, quantity, transactionItem.productId);
      }
    } else {
      for (const item of transaction.items) {
        addToRestore(item.inventoryId, item.quantity, item.productId);
      }
    }

    // Flip the status FIRST and conditionally: it is the lock that makes a second
    // concurrent refund of the same sale impossible.
    const [flipped] = await tx
      .update(salesTransactions)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(and(
        eq(salesTransactions.id, transactionId),
        eq(salesTransactions.status, 'completed'),
      ))
      .returning({ id: salesTransactions.id });

    if (!flipped) {
      throw new SaleError('Transaction is no longer refundable', 409,
        'Reload the receipt - another user may have just refunded or cancelled it');
    }

    for (const [inventoryId, entry] of Array.from(restore.entries())) {
      await applyStockChange(tx, {
        inventoryId,
        delta: entry.quantity,
        reason: 'refund',
        transactionType: 'RETURN' as const,
        productId: entry.productId,
        storeId: transaction.storeId,
        refType: 'sales_transaction',
        refId: transactionId,
        userId,
      });
    }

    await tx.insert(salesTransactionActions).values({
      salesTransactionId: transactionId,
      actionType: 'refund_processed',
      actionData: actionData({
        refundAmount: requestedRefund,
        reason: reason || 'No reason provided',
        items: items && items.length > 0 ? items : 'full refund',
      }),
      performedByUserId: userId,
    });

    return { refundAmount: requestedRefund };
  });
}

export interface CancelSaleInput {
  transactionId: number;
  userId: number;
  reason?: string;
}

export async function cancelSale(input: CancelSaleInput) {
  const { transactionId, userId, reason } = input;

  return db.transaction(async (tx) => {
    const transaction = await tx.query.salesTransactions.findFirst({
      where: eq(salesTransactions.id, transactionId),
      with: { items: true },
    });

    if (!transaction) {
      throw new SaleError('Sales transaction not found', 404, 'Verify the transaction ID');
    }
    if (transaction.status !== 'completed') {
      throw new SaleError('Only completed transactions can be cancelled',
        400, 'Transaction must be in completed status to cancel');
    }

    const [flipped] = await tx
      .update(salesTransactions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(salesTransactions.id, transactionId),
        eq(salesTransactions.status, 'completed'),
      ))
      .returning({ id: salesTransactions.id });

    if (!flipped) {
      throw new SaleError('Transaction is no longer cancellable', 409,
        'Reload the receipt - another user may have just cancelled or refunded it');
    }

    // AI Agent Note: cancelling used to change only the status, so the units stayed
    // deducted and inventory drifted downwards on every void. A cancellation reverses
    // the sale, therefore it puts the goods back.
    for (const item of transaction.items) {
      await applyStockChange(tx, {
        inventoryId: item.inventoryId,
        delta: item.quantity,
        reason: 'cancel',
        transactionType: 'RETURN' as const,
        productId: item.productId,
        storeId: transaction.storeId,
        refType: 'sales_transaction',
        refId: transactionId,
        userId,
      });
    }

    await tx.insert(salesTransactionActions).values({
      salesTransactionId: transactionId,
      actionType: 'transaction_cancelled',
      actionData: actionData({ reason: reason || 'Cancelled by user', cancelledBy: userId }),
      performedByUserId: userId,
    });
  });
}

