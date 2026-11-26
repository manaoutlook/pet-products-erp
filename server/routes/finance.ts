import type { Express, Response } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth, requirePermission } from "../middleware";
import { idParamSchema, validateBody, validateParams, validateQuery } from "../validate";
import { FINANCE_ENTRY_TYPES, FUNDING_KINDS } from "../../shared/finance";
import { PAYMENT_METHODS } from "../../shared/invoice-payment";
import {
  FinanceError,
  cashOnHandAsOf,
  createFinanceEntry,
  createFinancePartner,
  deleteFinancePartner,
  financeSummary,
  getFinanceEntry,
  listFinanceEntries,
  listFinancePartners,
  updateFinanceEntry,
  updateFinancePartner,
  voidFinanceEntry,
} from "../finance";
import { listInvoices } from "../invoices";
import { cashBookLedger, customerStatementLedger, ledgerCustomers } from "../ledger";
import { resolveScope, scopeStoreIds } from "../scoping";

/**
 * Financial Accounts endpoints.
 *
 * GET  /api/finance/summary     - income / expenses / capital / outstanding receivables report
 * GET  /api/finance/cash-on-hand - money on hand per payment method (a balance, for the Dashboard)
 * GET  /api/finance/outstanding - the receivable rows behind the report, partially paid included
 * GET  /api/finance/ledger      - the printable cash book / customer statement (read model)
 * GET  /api/finance/ledger/customers - customers a statement can be printed for
 * GET  /api/finance/entries     - the manual money book (filterable)
 * POST /api/finance/entries     - record expense / income / partner deposit / withdrawal
 * PATCH /api/finance/entries/:id - correct a posted entry (administrators only)
 * POST /api/finance/entries/:id/void - void an entry (reason required, row kept)
 * GET  /api/finance/partners    - partners with their live capital balance
 * POST /api/finance/partners    - add a partner
 * PATCH /api/finance/partners/:id - correct a partner's details (administrators only)
 * DELETE /api/finance/partners/:id - delete a partner whose balance is zero (administrators only)
 *
 * Money received against an invoice is NOT posted here: `/api/invoices/:id/payments` (Receivables)
 * owns that stream and the report reads it from `invoice_payments`.
 */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format");

const summaryQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

const entriesQuerySchema = z.object({
  entryType: z.enum(FINANCE_ENTRY_TYPES).optional(),
  status: z.enum(["posted", "voided"]).optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(100).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const outstandingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * The printable ledger. `kind` picks the sheet:
 *   cash_book          - every receipt and manual entry in the period, with an opening balance;
 *   customer_statement - one customer's invoices (charges) and receipts (payments).
 * Both are read-only views over existing tables and both need a customer for the statement.
 */
const ledgerQuerySchema = z
  .object({
    kind: z.enum(["cash_book", "customer_statement"]).default("cash_book"),
    from: dateString.optional(),
    to: dateString.optional(),
    customerProfileId: z.coerce.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "customer_statement" && !value.customerProfileId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerProfileId"],
        message: "Choose the customer whose statement you want",
      });
    }
  });


const createEntryBodySchema = z
  .object({
    entryType: z.enum(FINANCE_ENTRY_TYPES, {
      required_error: "Choose what kind of entry this is",
    }),
    category: z.string().trim().min(1, "Choose a category").max(80),
    description: z
      .string()
      .trim()
      .min(1, "Describe what the money was for")
      .max(500, "Keep the description under 500 characters"),
    amount: z.coerce
      .number({ invalid_type_error: "Enter an amount" })
      .positive("Enter an amount greater than zero")
      .max(999_999_999_999, "Amount is too large"),
    entryDate: dateString,
    paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
    reference: z.string().trim().max(100).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    partnerId: z.coerce.number().int().positive().optional().nullable(),
    fundingKind: z.enum(FUNDING_KINDS).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const partnerEntry =
      value.entryType === "partner_deposit" || value.entryType === "partner_withdrawal";

    if (partnerEntry && !value.partnerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerId"],
        message: "Choose the partner whose money this is",
      });
    }
    if (partnerEntry && !value.fundingKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fundingKind"],
        message: "Choose capital or a temporary loan",
      });
    }
    if (!partnerEntry && value.partnerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerId"],
        message: "Only partner deposits and withdrawals name a partner",
      });
    }
  });

const voidBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason for voiding this entry")
    .max(500, "Keep the reason under 500 characters"),
});

const createPartnerBodySchema = z.object({
  name: z.string().trim().min(1, "Enter the partner's name").max(200),
  phone: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/** Postgres 42P01 = the table has not been created in this database yet. */
function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

function respondWithError(res: Response, error: unknown, fallback: string) {
  if (error instanceof FinanceError) {
    return res.status(error.status).json({
      message: error.message,
      suggestion: error.suggestion,
    });
  }

  console.error(fallback, error);

  if (isMissingTable(error)) {
    return res.status(500).json({
      message:
        "The financial accounts tables do not exist in this database - apply the schema and try again.",
      suggestion: "Run `npm run db:push` against this database, then reload the page.",
    });
  }

  return res.status(500).json({ message: fallback, suggestion: "Please try again." });
}

export function registerFinanceRoutes(app: Express) {
  app.get(
    "/api/finance/summary",
    requireAuth,
    requirePermission("finance", "read"),
    validateQuery(summaryQuerySchema),
    async (req, res) => {
      try {
        const { from, to } = req.query as unknown as z.infer<typeof summaryQuerySchema>;
        return res.json(await financeSummary({ from, to }));
      } catch (error) {
        return respondWithError(res, error, "Failed to build the financial report");
      }
    }
  );

  /**
   * Money on hand, as a balance, for screens that only need "how much is left?" (the Dashboard).
   * Same money as `summary.cashOnHand`, from the same builder, so the two screens cannot disagree.
   * No `from`: a balance describes the till today, not a period.
   */
  app.get(
    "/api/finance/cash-on-hand",
    requireAuth,
    requirePermission("finance", "read"),
    async (_req, res) => {
      try {
        return res.json(await cashOnHandAsOf());
      } catch (error) {
        return respondWithError(res, error, "Failed to read the money on hand");
      }
    }
  );

  /**
   * The outstanding receivable rows. Delegates to `listInvoices`, so "partially paid" and
   * "overdue" mean exactly what the Receivables screen means by them; the finance screen only
   * highlights them differently. Store-scoped staff see their own stores, plus storeless
   * (sales-order) invoices, exactly like Receivables.
   */
  app.get(
    "/api/finance/outstanding",
    requireAuth,
    requirePermission("finance", "read"),
    validateQuery(outstandingQuerySchema),
    async (req, res) => {
      try {
        const { limit } = req.query as unknown as z.infer<typeof outstandingQuerySchema>;
        const scope = await resolveScope(req.user!);
        const result = await listInvoices({
          status: "outstanding",
          storeIds: scopeStoreIds(scope),
          limit,
          offset: 0,
        });

        return res.json({
          invoices: result.invoices,
          summary: result.summary,
          today: result.today,
        });
      } catch (error) {
        return respondWithError(res, error, "Failed to load outstanding receivables");
      }
    }
  );

  /** Customers that have invoices - fills the "print a statement for" picker. */
  app.get(
    "/api/finance/ledger/customers",
    requireAuth,
    requirePermission("finance", "read"),
    async (_req, res) => {
      try {
        return res.json({ customers: await ledgerCustomers() });
      } catch (error) {
        return respondWithError(res, error, "Failed to load the customers for statements");
      }
    }
  );

  /**
   * The printable ledger: the cash book, or one customer's statement.
   *
   * Nothing is stored by this endpoint. Both sheets are built from `invoice_payments`,
   * `finance_entries` and `invoices` at read time, so a printed figure can always be traced back
   * to the documents on the Receivables and Manual entries screens.
   */
  app.get(
    "/api/finance/ledger",
    requireAuth,
    requirePermission("finance", "read"),
    validateQuery(ledgerQuerySchema),
    async (req, res) => {
      try {
        const { kind, from, to, customerProfileId } = req.query as unknown as z.infer<
          typeof ledgerQuerySchema
        >;

        const document =
          kind === "customer_statement"
            ? await customerStatementLedger(customerProfileId!, { from, to })
            : await cashBookLedger({ from, to });

        return res.json({ document });
      } catch (error) {
        return respondWithError(res, error, "Failed to build the ledger");
      }
    }
  );

  app.get(
    "/api/finance/entries",
    requireAuth,
    requirePermission("finance", "read"),
    validateQuery(entriesQuerySchema),
    async (req, res) => {
      try {
        const filters = req.query as unknown as z.infer<typeof entriesQuerySchema>;
        return res.json(await listFinanceEntries(filters));
      } catch (error) {
        return respondWithError(res, error, "Failed to load finance entries");
      }
    }
  );

  app.get(
    "/api/finance/entries/:id",
    requireAuth,
    requirePermission("finance", "read"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
        return res.json({ entry: await getFinanceEntry(id) });
      } catch (error) {
        return respondWithError(res, error, "Failed to load the finance entry");
      }
    }
  );

  app.post(
    "/api/finance/entries",
    requireAuth,
    requirePermission("finance", "create"),
    validateBody(
      createEntryBodySchema,
      "Check the entry type, amount, date and description and try again"
    ),
    async (req, res) => {
      try {
        const body = req.body as z.infer<typeof createEntryBodySchema>;
        const entry = await createFinanceEntry({
          ...body,
          createdByUserId: req.user!.id,
        });
        return res.status(201).json({ entry });
      } catch (error) {
        return respondWithError(res, error, "Failed to record the finance entry");
      }
    }
  );

  /**
   * Correct a posted entry.
   *
   * This is the only finance write that is gated on the administrator role itself, not just on the
   * `finance.update` grant: editing changes a row the ledger already quotes, while voiding (which
   * any finance updater may do) keeps the original visible. The body is the same shape as POST, so
   * the screen reuses one form and the validation rules cannot drift.
   */
  app.patch(
    "/api/finance/entries/:id",
    requireAuth,
    requireAdmin,
    requirePermission("finance", "update"),
    validateParams(idParamSchema),
    validateBody(
      createEntryBodySchema,
      "Check the entry type, amount, date and description and try again"
    ),
    async (req, res) => {
      try {
        const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
        const body = req.body as z.infer<typeof createEntryBodySchema>;
        const entry = await updateFinanceEntry({ entryId: id, ...body });
        return res.json({ entry, message: "Entry updated" });
      } catch (error) {
        return respondWithError(res, error, "Failed to update the finance entry");
      }
    }
  );

  app.post(
    "/api/finance/entries/:id/void",
    requireAuth,
    requirePermission("finance", "update"),
    validateParams(idParamSchema),
    validateBody(voidBodySchema, "Give a reason for voiding this entry"),
    async (req, res) => {
      try {
        const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
        const { reason } = req.body as z.infer<typeof voidBodySchema>;
        const entry = await voidFinanceEntry({
          entryId: id,
          voidedByUserId: req.user!.id,
          reason,
        });
        return res.json({
          entry,
          message: "Entry voided - it stays in the book and no longer counts",
        });
      } catch (error) {
        return respondWithError(res, error, "Failed to void the finance entry");
      }
    }
  );

  app.get(
    "/api/finance/partners",
    requireAuth,
    requirePermission("finance", "read"),
    async (_req, res) => {
      try {
        return res.json(await listFinancePartners());
      } catch (error) {
        return respondWithError(res, error, "Failed to load finance partners");
      }
    }
  );

  app.post(
    "/api/finance/partners",
    requireAuth,
    requirePermission("finance", "create"),
    validateBody(createPartnerBodySchema, "Enter the partner's name"),
    async (req, res) => {
      try {
        const body = req.body as z.infer<typeof createPartnerBodySchema>;
        const partner = await createFinancePartner({
          ...body,
          createdByUserId: req.user!.id,
        });
        return res.status(201).json({ partner });
      } catch (error) {
        return respondWithError(res, error, "Failed to add the partner");
      }
    }
  );

  /**
   * Correct a partner's details. Administrators only, like correcting an entry: the name is what
   * every past deposit is reported under, so it is not a clerk's call.
   */
  app.patch(
    "/api/finance/partners/:id",
    requireAuth,
    requireAdmin,
    requirePermission("finance", "update"),
    validateParams(idParamSchema),
    validateBody(createPartnerBodySchema, "Enter the partner's name"),
    async (req, res) => {
      try {
        const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
        const body = req.body as z.infer<typeof createPartnerBodySchema>;
        const partner = await updateFinancePartner({ partnerId: id, ...body });
        return res.json({ partner, message: "Partner updated" });
      } catch (error) {
        return respondWithError(res, error, "Failed to update the partner");
      }
    }
  );

  /**
   * Delete a partner. Administrators only, and the service refuses while their balance is not
   * zero - money the owner is holding cannot be deleted off the report by accident.
   */
  app.delete(
    "/api/finance/partners/:id",
    requireAuth,
    requireAdmin,
    requirePermission("finance", "update"),
    validateParams(idParamSchema),
    async (req, res) => {
      try {
        const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
        return res.json({
          ...(await deleteFinancePartner(id)),
          message: "Partner deleted",
        });
      } catch (error) {
        return respondWithError(res, error, "Failed to delete the partner");
      }
    }
  );
}

