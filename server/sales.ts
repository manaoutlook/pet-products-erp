import { db } from "@db";
import {
  customerProfiles,
  inventory,
  products,
  salesTransactionActions,
  salesTransactionItems,
  salesTransactions,
  userStoreAssignments,
  vatCompanies,
} from "@db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { generateInvoiceNumber, generateVatCompanyInvoiceNumber } from "./invoice-counter";
import { applyStockChange, recordStockMovements } from "./stock-ledger";
import { computeSaleTotals, VAT_RATE } from "../shared/tax";
import { VAT_COMPANY_SEEDS } from "../shared/invoice";

export interface SaleItemInput {
  productId: number;
  quantity: number;
}

export interface SaleBuyerInput {
  name: string;
  companyName?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CreateSaleInput {
  userId: number;
  items: SaleItemInput[];
  paymentMethod: string;
  customerProfileId?: number | null;
  transactionType?: 'STORE_SALE' | 'DC_SALE';
  /**
   * True when the customer asked for a VAT invoice (`Print with VAT`).
   *
   * AI Agent Note - the VAT choice is part of creating the sale, not of rendering it.
   * `sales_transactions.subtotal` / `vat_rate` / `vat_amount` / `total_amount` are written
   * once here, and every document (till receipt, A4 invoice, reprint) reads them back.
   * A sale created with `withVat: false` must never be re-printed "with VAT" later - that
   * would be a different legal document; the shop would have to issue a new invoice.
   */
  withVat?: boolean;
  /** Which licensed company issues the VAT invoice. Required when `withVat` is true. */
  vatCompanyId?: number | null;
  /**
   * The buyer block, typed at the counter or copied from a customer profile.
   *
   * A VAT invoice is invalid without a buyer, and the details must be frozen onto the sale -
   * editing the customer profile later must not change an invoice already issued.
   */
  buyer?: SaleBuyerInput | null;
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

  // ---------------------------------------------------------------------------------
  // VAT invoice (or plain retail sale)
  // ---------------------------------------------------------------------------------
  // `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH` may not issue a VAT invoice. A customer who asks for
  // one is invoiced by one of the licensed companies below, and that company's name, tax
  // code and address are what the invoice prints - not the household letterhead.
  //
  // The choice is validated here and recorded on the sale (`vat_company_id`), so a reprint
  // years later still knows which company issued it and which number sequence it came from
  // (CI-... or HI-...). Both are read-only lookups on a tiny table; doing them before the
  // transaction keeps the write window short.
  const withVat = input.withVat === true;
  let vatCompany: typeof vatCompanies.$inferSelect | null = null;

  if (withVat) {
    if (transactionType === 'DC_SALE') {
      throw new SaleError(
        'A VAT invoice cannot be issued for a DC sale',
        400,
        'DC sales are internal transfers, not customer invoices',
      );
    }

    const requestedId = Number(input.vatCompanyId);
    if (!Number.isInteger(requestedId) || requestedId <= 0) {
      throw new SaleError(
        'Select the company that issues the VAT invoice',
        400,
        `Choose ${VAT_COMPANY_SEEDS.map((c) => `${c.code} (${c.name})`).join(' or ')}`,
      );
    }

    vatCompany = (await db.query.vatCompanies.findFirst({
      where: eq(vatCompanies.id, requestedId),
    })) ?? null;

    if (!vatCompany) {
      throw new SaleError('The selected VAT company does not exist', 400,
        'Reload the VAT Companies screen and try again');
    }
    if (!vatCompany.isActive) {
      throw new SaleError(
        `VAT invoices cannot be issued under ${vatCompany.name} because it is inactive`,
        400,
        'Activate the company in the VAT Companies screen or choose another one',
      );
    }
    // A VAT invoice is invalid without the seller's legal name, address and tax code.
    const missing: string[] = [];
    if (!vatCompany.name?.trim()) missing.push('Company name');
    if (!vatCompany.taxId?.trim()) missing.push('Tax code');
    if (!vatCompany.address?.trim()) missing.push('Address');
    if (missing.length > 0) {
      throw new SaleError(
        `${vatCompany.name || vatCompany.code} cannot issue a VAT invoice: ${missing.join(', ')} missing`,
        400,
        'Complete the company details in the VAT Companies screen first',
      );
    }
  }

  // ---------------------------------------------------------------------------------
  // Buyer snapshot
  // ---------------------------------------------------------------------------------
  // AI Agent Note: the buyer is copied onto the sale, not merely referenced. A VAT invoice is
  // invalid without a buyer, and a customer profile that is edited or deleted next month must
  // not be able to rewrite an invoice that was already printed. Precedence:
  //   1. the details typed at the counter (`input.buyer`), which is how a walk-in company buys;
  //   2. the customer profile attached to the sale;
  //   3. nothing - allowed for a retail sale, refused for a VAT invoice (below).
  const buyerFromInput = input.buyer ?? null;
  let buyerSnapshot = {
    name: buyerFromInput?.name?.trim() ?? '',
    companyName: buyerFromInput?.companyName?.trim() || null,
    taxId: buyerFromInput?.taxId?.trim() || null,
    address: buyerFromInput?.address?.trim() || null,
    phone: buyerFromInput?.phone?.trim() || null,
    email: buyerFromInput?.email?.trim() || null,
  };

  if (customerProfileId) {
    const profile = await db.query.customerProfiles.findFirst({
      where: eq(customerProfiles.id, customerProfileId),
      columns: {
        contactPerson: true,
        companyName: true,
        mobileNumber: true,
        address: true,
        email: true,
        // The buyer's tax code is what a VAT invoice prints against the customer, so the
        // profile is the natural source when the counter did not type one.
        taxId: true,
      },
    });

    if (profile) {
      buyerSnapshot = {
        name:
          buyerSnapshot.name ||
          profile.contactPerson ||
          profile.companyName ||
          profile.mobileNumber,
        companyName: buyerSnapshot.companyName || profile.companyName,
        taxId: buyerSnapshot.taxId || profile.taxId || null,
        address: buyerSnapshot.address || profile.address,
        phone: buyerSnapshot.phone || profile.mobileNumber,
        email: buyerSnapshot.email || profile.email,
      };
    }
  }

  if (withVat && !buyerSnapshot.name) {
    throw new SaleError(
      'A VAT invoice needs the buyer name and address',
      400,
      'Enter the buyer details at checkout, or attach a customer profile to the sale',
    );
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
    // AI Agent Note - the invoice number is allocated inside this transaction, and it comes
    // from a different book depending on the customer's choice:
    //   with VAT -> that company's own sequence (CI-YYYYMMDD-NNNN / HI-YYYYMMDD-NNNN)
    //   no VAT   -> the store's retail sequence (STR001-YYYYMMDD-NNNN)
    // Both counter increments roll back with the sale, so a failed sale never burns a
    // number out of the company's tax book.
    const invoiceNumber = vatCompany
      ? await generateVatCompanyInvoiceNumber(vatCompany.id, vatCompany.code, tx)
      : await generateInvoiceNumber(storeId, transactionType, tx);

    const pricedItems: Array<{
      productId: number; inventoryId: number; quantity: number;
      unitPrice: number; totalPrice: number;
      /** Snapshot of the catalogue at sale time - see db/schema.ts sales_transaction_items. */
      productCode: string; description: string;
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
        // The name and SKU are copied onto the sale now. `productId` still points at the
        // product for reporting, but the invoice prints these strings - so renaming the
        // product tomorrow cannot change what an already-issued invoice says.
        productCode: product.sku ?? '',
        description: product.name ?? '',
        // RETURNING gives the post-decrement value from the same statement, so the pair is
        // correct even when another till sells the same row concurrently.
        quantityAfter: deducted.quantity,
        quantityBefore: deducted.quantity + quantity,
      });
    }

    // ---------------------------------------------------------------------------------
    // The money, computed once
    // ---------------------------------------------------------------------------------
    // Catalogue prices are VAT-EXCLUSIVE. `computeSaleTotals` is the single implementation
    // of the rule (shared/tax.ts) and the only place VAT is added:
    //   subtotal    = sum(line totals)
    //   vatAmount   = withVat ? round(subtotal * VAT_RATE) : 0
    //   totalAmount = subtotal + vatAmount
    // These three numbers are stored and never recomputed. Before this, the till added 10%
    // in the browser, the database stored the VAT-exclusive total, and a reprint divided the
    // total by 1.1 - a 100,000 sale showed 110,000 at the till, 100,000 in the database and
    // 90,909.09 + 9,090.91 on the reprint. Do not reintroduce a `* 0.1` or `/ 1.1` anywhere.
    const totals = computeSaleTotals(
      pricedItems.reduce((sum, item) => sum + item.totalPrice, 0),
      withVat,
      VAT_RATE,
    );

    const [salesTransaction] = await tx
      .insert(salesTransactions)
      .values({
        invoiceNumber,
        storeId,
        transactionType,
        cashierUserId: userId,
        customerProfileId: customerProfileId || null,
        subtotal: totals.subtotal.toString(),
        vatRate: totals.vatRate.toString(),
        vatAmount: totals.vatAmount.toString(),
        totalAmount: totals.total.toString(),
        printedWithVat: withVat,
        vatCompanyId: vatCompany?.id ?? null,
        buyerName: buyerSnapshot.name,
        buyerCompanyName: buyerSnapshot.companyName,
        buyerTaxId: buyerSnapshot.taxId,
        buyerAddress: buyerSnapshot.address,
        buyerPhone: buyerSnapshot.phone,
        buyerEmail: buyerSnapshot.email,
        paymentMethod,
        status: 'completed',
      })
      .returning({ id: salesTransactions.id });

    await tx.insert(salesTransactionItems).values(
      pricedItems.map((item) => ({
        salesTransactionId: salesTransaction.id,
        productId: item.productId,
        inventoryId: item.inventoryId,
        productCode: item.productCode,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        totalPrice: item.totalPrice.toString(),
      })),
    );

    await tx.insert(salesTransactionActions).values({
      salesTransactionId: salesTransaction.id,
      actionType: 'sale_completed',
      actionData: actionData({
        itemsCount: pricedItems.length,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        totalAmount: totals.total,
        withVat,
        vatCompany: vatCompany?.code ?? null,
        invoiceNumber,
      }),
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
  // (relations: items/products/inventory/store/cashier/customer/vatCompany).
  return db.query.salesTransactions.findFirst({
    where: eq(salesTransactions.id, saleId),
    with: {
      items: { with: { product: true, inventory: true } },
      store: true,
      cashierUser: true,
      customerProfile: true,
      vatCompany: true,
    },
  });
}

/**
 * Why there is no credit-note document (yet) - decision recorded 2026-11-09.
 *
 * A refund/cancellation is NOT an edit of the invoice. It:
 *   1. flips `sales_transactions.status` to `refunded` / `cancelled`, so every reprint of
 *      that invoice is stamped CANCELLED (see shared/invoice.ts isCancelledStatus) and can
 *      never be passed off as a valid document;
 *   2. writes a `sales_transaction_actions` audit row (who, when, how much, why);
 *   3. puts the stock back through the ledger with `RETURN` movements.
 *
 * That is a complete audit trail, but it is not the same paper as a credit note (a formal
 * document that links to the original invoice, lists the returned lines, reverses the VAT
 * and carries its own number). The owner has not asked for one yet, so no credit note is
 * issued and the UI must not imply that one exists.
 *
 * If a credit note is added later: give it its own sequence (e.g. `CN-YYYYMMDD-NNNN`), its
 * own archived PDF, a reference to the cancelled invoice number and the same seller block
 * as the invoice it corrects. Re-issuing a corrected invoice is done the other way round:
 * cancel the wrong invoice (status change above + the sale is reversed), then ring up and
 * invoice the correction as a NEW sale with a NEW number. Never overwrite an issued one.
 */
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

