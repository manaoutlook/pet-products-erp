# Step 03 — Make POS sale / refund / cancel atomic

**Priority:** P0 · **Risk:** medium · **New dependencies:** none
**Files:** `server/db-types.ts` (new), `server/sales.ts` (new), `server/invoice-counter.ts`,
`server/routes.ts`, `tests/backend/api/pos-atomicity.test.ts` (new)

---

## 1. Problem

`server/routes.ts` contains exactly **one** `db.transaction(...)` call (store deletion,
line 350). Everything that moves money and stock runs as a sequence of independent writes, so
every mid-way failure leaves the database inconsistent.

### 1a. A sale is neither atomic nor race-safe — `server/routes.ts:3632-3752`

```ts
// 1. reads inventory, checks quantity          <-- nobody holds a lock
const availableInventory = await db.query.inventory.findFirst({ ... });
if (availableInventory.quantity < item.quantity) { return 400 }

// 2. later, in parallel, decrements with no guard
await db.insert(salesTransactions).values({...});                 // separate statement
await Promise.all(validatedItems.map(async (item) => {
  await db.insert(salesTransactionItems).values({...});           // separate statement
  await db.update(inventory)
    .set({ quantity: sql`${inventory.quantity} - ${item.quantity}` })   // NO WHERE guard
    .where(eq(inventory.id, item.inventoryId));
}));
await db.insert(salesTransactionActions).values({...});           // separate statement
```

Consequences:

| Failure | Result |
| --- | --- |
| Two cashiers sell the last unit simultaneously | both pass the `quantity <` check, both decrement → **stock goes negative** |
| Process/connection dies between step 1 and 2 | receipt + line items exist, stock never decremented (or partially decremented) |
| Item insert throws for line 2 of 3 | lines 1 and 3 committed, line 2 missing, stock short by one line |
| Product price is read outside any transaction and then written into the receipt | price change mid-sale records a total that never existed |

Also note `quantity: sql`... - ${item.quantity}`` is built via `sql` template interpolation of a
plain JS number — fine for a number, but it means the "is there enough stock?" decision lives
only in application code that already ran.

### 1b. Refund is not atomic — `server/routes.ts:4047-4107`

Restores inventory in a loop, then flips the status, then inserts the action log — three
independent commits. A failure after the loop leaves stock restored with the transaction still
`completed`, so the refund can be executed twice.

### 1c. Cancel does not restore stock — `server/routes.ts:4152-4170`

`status` becomes `cancelled` and nothing else happens: the units stay deducted forever.

### 1d. Invoice counter is read-modify-write — `server/invoice-counter.ts:34-76`

```ts
const newNumber = counter.currentNumber + 1;
await tx.update(invoiceCounters).set({ currentNumber: newNumber })   // lost-update race
```
Two concurrent sales can compute the same number. `generateInvoiceNumber` also opens its **own**
transaction, which makes it impossible to call from inside the sale transaction (it would use a
second pooled connection and silently commit independently).

---

## 2. Design

Three moves, all following the module-extraction pattern already used by `store-deletion.ts`,
`invoice-counter.ts` and `master-data-import.ts`:

1. `server/db-types.ts` — a `DbClient` type so helpers accept either `db` or a transaction.
2. `server/invoice-counter.ts` — `generateInvoiceNumber(storeId, type, executor?)`, atomic
   increment, uses the caller's transaction when given one.
3. `server/sales.ts` — `createSale`, `refundSale`, `cancelSale` as **single-transaction**
   services that throw a typed `SaleError` (`{ status, suggestion }`). Routes become thin
   wrappers: validate → call service → map `SaleError` to `{ message, suggestion }`.

Rules the services follow:

- **Every stock write is conditional**: `UPDATE inventory SET quantity = quantity - n
  WHERE id = ? AND quantity >= n RETURNING quantity`. No row returned ⇒ insufficient stock ⇒
  throw ⇒ the whole transaction rolls back. This is the actual concurrency guard; the
  pre-check only exists to produce a nice message.
- **Status changes are conditional** (`WHERE status = 'completed'`) so double-refund /
  double-cancel is impossible even with two simultaneous requests.
- **Prices are re-read inside the transaction** and used for both the line item and the total.
- **Duplicate product ids are merged** into one line before deduction, so a cart with the same
  SKU twice cannot pass the stock check twice on one unit of stock.

### Deliberate behaviour changes (call these out in the commit message)

1. `cancel` now **restores stock** (previously it silently lost the units).
2. A cancelled transaction can no longer be refunded (it has nothing to give back).
3. Errors return `400/403/404/409` with the same `{message, suggestion}` shape; the generic
   `500 "Failed to complete sales transaction"` only remains for genuinely unexpected errors.

---

## 3. Implementation

### 3a. `server/db-types.ts` (new)

```ts
import type { db } from "@db";

/**
 * Either the root drizzle client or an active transaction.
 *
 * AI Agent Note: helpers such as generateInvoiceNumber and the sale services must
 * run inside the caller's transaction, otherwise they silently commit on their own
 * connection and the surrounding atomicity is a lie. This type lets them accept both.
 */
export type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
```

### 3b. `server/invoice-counter.ts` — atomic increment + executor parameter

Replace `generateInvoiceNumber` (lines 27-79) with the version below. Add
`import type { DbClient } from "./db-types";` at the top (`eq, and, sql` are already imported).

```ts
export async function generateInvoiceNumber(
  storeId: number | null,
  transactionType: 'STORE_SALE' | 'DC_SALE',
  executor?: DbClient
): Promise<string> {
  const counterType = storeId ? 'STORE' : 'DC';

  const run = async (tx: DbClient): Promise<string> => {
    const whereClause = storeId
      ? and(eq(invoiceCounters.storeId, storeId), eq(invoiceCounters.counterType, counterType))
      : eq(invoiceCounters.counterType, counterType);

    let counter = await tx.query.invoiceCounters.findFirst({ where: whereClause });

    if (!counter) {
      const prefix = storeId ? generateStorePrefix(storeId) : generateDCPrefix();
      const [created] = await tx
        .insert(invoiceCounters)
        .values({ storeId, counterType, currentNumber: 0, prefix })
        .onConflictDoNothing()
        .returning();
      // A concurrent sale may have created it first - re-read in that case.
      counter = created ?? (await tx.query.invoiceCounters.findFirst({ where: whereClause }))!;
    }

    // AI Agent Note: increment in SQL, not in JS. Reading currentNumber and writing
    // currentNumber + 1 lets two concurrent sales compute the same number; letting
    // Postgres add one to the stored value under the row lock cannot.
    const [updated] = await tx
      .update(invoiceCounters)
      .set({
        currentNumber: sql`${invoiceCounters.currentNumber} + 1`,
        lastUpdated: new Date(),
      })
      .where(eq(invoiceCounters.id, counter.id))
      .returning({ currentNumber: invoiceCounters.currentNumber, prefix: invoiceCounters.prefix });

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${updated.prefix}${dateStr}-${updated.currentNumber.toString().padStart(4, '0')}`;
  };

  // Callers that already hold a transaction must pass it, so the counter commits or
  // rolls back together with the sale.
  return executor ? run(executor) : db.transaction(run);
}
```

Keep every other export (`generateStorePrefix`, `generateDCPrefix`,
`initializeStoreCounter`, `getCurrentCounter`, `resetCounter`, `getAllCounters`,
`validateInvoiceNumber`) unchanged.

> Known limitation, out of scope: `invoice_counters` has no unique constraint on
> `(store_id, counter_type)`, so two *first-ever* concurrent sales in a brand-new store can
> still create two counter rows. Seed counters for every store at creation time
> (`initializeStoreCounter` already exists and is called on store create) or add the unique
> index in a later step — do not mix it into this one.

### 3c. `server/sales.ts` (new) — `createSale`

Create the file with this content (part 2 of the file, `refundSale` / `cancelSale`, is 3d):

```ts
import { db } from "@db";
import {
  inventory, products, salesTransactionActions, salesTransactionItems,
  salesTransactions, userStoreAssignments,
} from "@db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { generateInvoiceNumber } from "./invoice-counter";

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
```

The remainder of `createSale` (the transaction body) follows in 3c-continued.

**3c-continued** — append to the same file, still inside `createSale`:

```ts
  const saleId = await db.transaction(async (tx) => {
    const invoiceNumber = await generateInvoiceNumber(storeId, transactionType, tx);

    const pricedItems: Array<{
      productId: number; inventoryId: number; quantity: number;
      unitPrice: number; totalPrice: number;
    }> = [];

    for (const [productId, quantity] of merged.entries()) {
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

      const product = stockRow.product
        ?? (await tx.query.products.findFirst({ where: eq(products.id, productId) }));
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
        .returning({ id: inventory.id });

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
      actionData: { itemsCount: pricedItems.length, totalAmount },
      performedByUserId: userId,
    });

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
```

### 3d. `server/sales.ts` — `refundSale`

Append to the same file (no extra imports needed):

```ts
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
    const restore = new Map<number, number>(); // inventoryId -> quantity
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
        restore.set(transactionItem.inventoryId,
          (restore.get(transactionItem.inventoryId) ?? 0) + quantity);
      }
    } else {
      for (const item of transaction.items) {
        restore.set(item.inventoryId, (restore.get(item.inventoryId) ?? 0) + item.quantity);
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

    for (const [inventoryId, quantity] of restore.entries()) {
      await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} + ${quantity}`, updatedAt: new Date() })
        .where(eq(inventory.id, inventoryId));
    }

    await tx.insert(salesTransactionActions).values({
      salesTransactionId: transactionId,
      actionType: 'refund_processed',
      actionData: {
        refundAmount: requestedRefund,
        reason: reason || 'No reason provided',
        items: items && items.length > 0 ? items : 'full refund',
      },
      performedByUserId: userId,
    });

    return { refundAmount: requestedRefund };
  });
}
```

### 3e. `server/sales.ts` — `cancelSale`

```ts
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
      await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} + ${item.quantity}`, updatedAt: new Date() })
        .where(eq(inventory.id, item.inventoryId));
    }

    await tx.insert(salesTransactionActions).values({
      salesTransactionId: transactionId,
      actionType: 'transaction_cancelled',
      actionData: { reason: reason || 'Cancelled by user', cancelledBy: userId },
      performedByUserId: userId,
    });
  });
}
```

---

## 4. Route rewiring in `server/routes.ts`

Add next to the `invoice-counter` import (line 31):

```ts
import { createSale, refundSale, cancelSale, SaleError } from "./sales";
```

`generateInvoiceNumber` may now be unused in `routes.ts` — drop it from the line-31 import if
`tsc` says so (keep `initializeStoreCounter`).

### 4a. Replace the whole sale handler (lines **3590-3781**)

```ts
  app.post("/api/sales-transactions", requirePermission('pos', 'create'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { items, paymentMethod, customerProfileId, transactionType } = req.body;

      const transaction = await createSale({
        userId: user.id,
        items,
        paymentMethod,
        customerProfileId,
        transactionType,
      });

      res.json({
        message: "Sales transaction completed successfully",
        transaction,
      });
    } catch (error) {
      if (error instanceof SaleError) {
        return res.status(error.status).json({
          message: error.message,
          ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        });
      }
      console.error('Error creating sales transaction:',
        error instanceof Error ? error.message : 'unknown error');
      res.status(500).json({
        message: "Failed to complete sales transaction",
        suggestion: "Please try again later"
      });
    }
  });
```

### 4b. Replace the refund handler (lines **3992-4120**)

```ts
  app.post("/api/sales-transactions/:id/refund", requirePermission('receipts', 'update'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transactionId = parseInt(req.params.id, 10);
      if (Number.isNaN(transactionId)) {
        return res.status(400).json({
          message: "Invalid transaction ID",
          suggestion: "Verify the transaction ID"
        });
      }

      const { refundAmount, reason, items } = req.body;

      const result = await refundSale({
        transactionId,
        userId: user.id,
        refundAmount,
        reason,
        items,
      });

      res.json({
        message: "Refund processed successfully",
        refundAmount: result.refundAmount,
      });
    } catch (error) {
      if (error instanceof SaleError) {
        return res.status(error.status).json({
          message: error.message,
          ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        });
      }
      console.error('Error processing refund:',
        error instanceof Error ? error.message : 'unknown error');
      res.status(500).json({
        message: "Failed to process refund",
        suggestion: "Please try again later"
      });
    }
  });
```

### 4c. Replace the cancel handler (lines **4123-4182**)

```ts
  app.post("/api/sales-transactions/:id/cancel", requirePermission('receipts', 'update'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transactionId = parseInt(req.params.id, 10);
      if (Number.isNaN(transactionId)) {
        return res.status(400).json({ message: "Invalid transaction ID" });
      }

      await cancelSale({ transactionId, userId: user.id, reason: req.body?.reason });

      res.json({ message: "Transaction cancelled successfully" });
    } catch (error) {
      if (error instanceof SaleError) {
        return res.status(error.status).json({
          message: error.message,
          ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        });
      }
      console.error('Error cancelling transaction:',
        error instanceof Error ? error.message : 'unknown error');
      res.status(500).json({
        message: "Failed to cancel transaction",
        suggestion: "Please try again later"
      });
    }
  });
```

### 4d. Import cleanup

If `sql` / `gte` / `inventory` / `salesTransactionItems` / `salesTransactionActions` become
unused after these removals, let `tsc` tell you which — do not remove imports by eye, other
handlers still use most of them.

---

## 5. Tests — `tests/backend/api/pos-atomicity.test.ts` (new)

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '../../../db';
import {
  inventory, products, salesTransactionActions, salesTransactionItems,
  salesTransactions, userStoreAssignments,
} from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import { eq } from 'drizzle-orm';
import { cancelSale, createSale, refundSale, SaleError } from '../../../server/sales';

describe('POS atomicity', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let stock: { id: number };
  let secondProductId: number;

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    // The cashier must be assigned to a store - createSale resolves it from here.
    await db.insert(userStoreAssignments).values({
      userId: data.users.admin.id,
      storeId: data.stores.store1.id,
    });

    const [row] = await db.insert(inventory).values({
      productId: data.products.product.id,
      storeId: data.stores.store1.id,
      inventoryType: 'STORE',
      quantity: 10,
    }).returning({ id: inventory.id });
    stock = row;

    // A product that exists but has no inventory in this store - forces a
    // mid-transaction failure.
    const [extra] = await db.insert(products).values({
      name: 'Unstocked Product',
      sku: 'TEST-002',
      price: '50.00',
      categoryId: data.categories.category.id,
      brandId: data.brands.brand.id,
    }).returning({ id: products.id });
    secondProductId = extra.id;
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  async function stockLevel() {
    const [row] = await db.select({ quantity: inventory.quantity })
      .from(inventory).where(eq(inventory.id, stock.id));
    return row.quantity;
  }

  it('deducts stock and records the sale in one commit', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 3 }],
      paymentMethod: 'CASH',
    });

    expect(sale?.status).toBe('completed');
    expect(sale?.items).toHaveLength(1);
    expect(await stockLevel()).toBe(7);

    const actions = await db.select().from(salesTransactionActions)
      .where(eq(salesTransactionActions.salesTransactionId, sale!.id));
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe('sale_completed');
  });

  it('rolls everything back when one line cannot be fulfilled', async () => {
    await expect(createSale({
      userId: data.users.admin.id,
      items: [
        { productId: data.products.product.id, quantity: 2 },
        { productId: secondProductId, quantity: 1 },
      ],
      paymentMethod: 'CASH',
    })).rejects.toBeInstanceOf(SaleError);

    expect(await db.select().from(salesTransactions)).toHaveLength(0);
    expect(await db.select().from(salesTransactionItems)).toHaveLength(0);
    expect(await stockLevel()).toBe(10); // first line was deducted, then rolled back
  });

  it('never oversells under concurrency', async () => {
    const sale = (quantity: number) => createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity }],
      paymentMethod: 'CASH',
    });

    const results = await Promise.allSettled([sale(6), sale(6)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await stockLevel()).toBe(4);
    expect(await db.select().from(salesTransactions)).toHaveLength(1);
  });

  it('restores stock on refund and refuses a second refund', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 4 }],
      paymentMethod: 'CARD',
    });
    expect(await stockLevel()).toBe(6);

    const refunded = await refundSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
      reason: 'customer changed mind',
    });
    expect(refunded.refundAmount).toBe(400);
    expect(await stockLevel()).toBe(10);

    await expect(refundSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
    })).rejects.toBeInstanceOf(SaleError);
    expect(await stockLevel()).toBe(10); // no double restore
  });

  it('restores stock on cancel and blocks cancelling twice', async () => {
    const sale = await createSale({
      userId: data.users.admin.id,
      items: [{ productId: data.products.product.id, quantity: 5 }],
      paymentMethod: 'CASH',
    });

    await cancelSale({ transactionId: sale!.id, userId: data.users.admin.id, reason: 'void' });
    expect(await stockLevel()).toBe(10);

    await expect(cancelSale({
      transactionId: sale!.id,
      userId: data.users.admin.id,
    })).rejects.toBeInstanceOf(SaleError);
    expect(await stockLevel()).toBe(10);
  });
});
```

Notes:

- `inventory.inventoryType: 'STORE'` is verified against the existing suite
  (`tests/backend/api/inventory.test.ts:34` and `:161` use `'STORE'` for store stock, `:168` uses
  `'DC'` for warehouse stock) — no change needed.
- If `seedTestData` already creates a store assignment or an inventory row, drop the duplicate
  insert rather than stacking two.
- These tests call the service directly, like the existing `pos.test.ts` calls drizzle
  directly — no HTTP layer, no supertest dependency.

---

## 6. Verification

```bash
npx vitest run tests/backend/api/pos-atomicity.test.ts
npx vitest run tests/backend/api/pos.test.ts      # existing POS suite must still pass
npx tsc --noEmit 2>&1 | grep -c "error TS"        # <= baseline
npm run dev
```

Manual checks on the POS page:

1. Sell 2 units → receipt appears, inventory drops by 2.
2. Try to sell more than available → toast “Insufficient stock for … Available: X, Requested:
   Y”, no receipt, stock unchanged.
3. Refund that receipt → stock returns; refund again → “Transaction has already been refunded”.
4. Cancel another receipt → stock returns; cancel again → error, stock still unchanged.

---

## 7. Rollback

```bash
git checkout server/routes.ts server/invoice-counter.ts
rm server/sales.ts server/db-types.ts tests/backend/api/pos-atomicity.test.ts
```

No schema change and no migration, so rollback is safe at any time. Note that
`server/db-types.ts` is reused by steps 04+ — if you roll back step 03 *after* those steps,
keep that file.

---

## 8. Done criteria

- [ ] `grep -c "db.transaction" server/sales.ts` → 3 (sale, refund, cancel)
- [ ] No unguarded `inventory` update remains in the POS paths of `server/routes.ts`
- [ ] The 5 new tests pass and `pos.test.ts` still passes
- [ ] tsc count unchanged, `vite build` clean
- [ ] Manual POS checks 1-4 passed
