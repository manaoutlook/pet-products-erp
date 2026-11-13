import type { Express } from "express";
import { z } from "zod";
import { db } from "@db";
import { vatCompanies } from "@db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAuth, requirePermission } from "../middleware";
import { validateBody, validateParams, idParamSchema } from "../validate";
import { initializeVatCompanyCounter } from "../invoice-counter";
import { vatCompanyMissingFields } from "../invoice-documents";
import { VAT_COMPANY_SEEDS } from "../../shared/invoice";

/**
 * VAT company endpoints - the two licensed companies that may issue a VAT invoice.
 *
 * GET  /api/vat-companies      - every company plus what is still missing on each
 * POST /api/vat-companies      - add one (allocates its own invoice sequence)
 * PUT  /api/vat-companies/:id  - edit one
 *
 * AI Agent Note: `HỘ KINH DOANH TIỆN ÍCH GIA ĐÌNH` is a household business and may not issue
 * a VAT invoice, so a VAT sale prints the name, tax code and address of the company selected
 * here. The sales screen asks "print with VAT?" first; only then does this list matter.
 *
 * GET is open to any signed-in user because the till has to render the choice at checkout;
 * writes need `masterData` create/update, exactly like every other master-data screen.
 */

export const vatCompanyBodySchema = z.object({
  code: z
    .string({ required_error: "Code is required" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "Code must be 2-10 letters or digits (e.g. CI, HI)")
    // The prefix is baked into every issued number, so the two seeded codes are reserved.
    .refine(
      (code) => !VAT_COMPANY_SEEDS.some((seed) => seed.code === code),
      "CI and HI are the two licensed companies and already exist - edit CI or HI in the list instead of adding a new one"
    ),
  name: z.string({ required_error: "Company name is required" }).trim().min(1, "Company name is required").max(200),
  taxId: z.string().trim().max(50).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  bankAccount: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const vatCompanyUpdateSchema = vatCompanyBodySchema.partial().omit({ code: true });

function serialise(company: typeof vatCompanies.$inferSelect) {
  return {
    ...company,
    missingFields: vatCompanyMissingFields(company),
  };
}

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

const MISSING_TABLE_MESSAGE =
  "The vat_companies table does not exist in this database - apply the schema (npm run db:push) and try again.";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/**
 * Make sure CI and HI exist, with a counter each.
 *
 * AI Agent Note: migration 0022 seeds them, but a database created by `npm run db:push` (which
 * builds the schema from db/schema.ts) would have the table and no rows - and the API refuses
 * to create the reserved codes CI/HI, so the two companies could never be added. Seeding here
 * closes that gap: whichever way the table was created, the two licensed companies are present
 * and only need their tax code and address filled in.
 */
export async function ensureVatCompanySeeds(): Promise<void> {
  try {
    for (const seed of VAT_COMPANY_SEEDS) {
      const [created] = await db
        .insert(vatCompanies)
        .values({ code: seed.code, name: seed.name })
        .onConflictDoNothing({ target: vatCompanies.code })
        .returning();

      const company =
        created ??
        (await db.query.vatCompanies.findFirst({ where: eq(vatCompanies.code, seed.code) }));

      if (company) {
        await initializeVatCompanyCounter(company.id, company.code);
      }
    }
  } catch (error) {
    if (!isMissingTable(error)) {
      console.error("Could not seed VAT companies:", error);
    }
  }
}

export function registerVatCompanyRoutes(app: Express) {
  app.get("/api/vat-companies", requireAuth, async (_req, res) => {
    try {
      const rows = await db.query.vatCompanies.findMany({
        orderBy: [asc(vatCompanies.code)],
      });
      res.json({ companies: rows.map(serialise) });
    } catch (error) {
      if (isMissingTable(error)) {
        console.error("vat_companies table is missing - run `npm run db:push`:", error);
        return res.status(500).json({
          message: MISSING_TABLE_MESSAGE,
          suggestion: "Run npm run db:push against this database, then reload the page.",
        });
      }
      console.error("Error fetching VAT companies:", error);
      res.status(500).json({ message: "Failed to fetch VAT companies" });
    }
  });

  app.post(
    "/api/vat-companies",
    requirePermission("masterData", "create"),
    validateBody(vatCompanyBodySchema, "Provide the company code, name, tax code and address"),
    async (req, res) => {
      try {
        const [created] = await db
          .insert(vatCompanies)
          .values({
            code: req.body.code,
            name: req.body.name,
            taxId: req.body.taxId ?? "",
            address: req.body.address ?? "",
            phone: req.body.phone ?? null,
            email: req.body.email ?? null,
            bankAccount: req.body.bankAccount ?? null,
            isActive: req.body.isActive ?? true,
          })
          .returning();

        // The company's own invoice sequence starts here, not on its first sale.
        await initializeVatCompanyCounter(created.id, created.code);

        res.status(201).json({ company: serialise(created), message: "VAT company created" });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return res.status(409).json({
            message: "That code is already used by another VAT company",
            suggestion: "Pick a different two-letter code",
          });
        }
        if (isMissingTable(error)) {
          return res.status(500).json({
            message: MISSING_TABLE_MESSAGE,
            suggestion: "Run npm run db:push against this database, then try again.",
          });
        }
        console.error("Error creating VAT company:", error);
        res.status(500).json({ message: "Failed to create VAT company" });
      }
    }
  );

  app.put(
    "/api/vat-companies/:id",
    requirePermission("masterData", "update"),
    validateParams(idParamSchema),
    validateBody(vatCompanyUpdateSchema, "Provide the fields to update"),
    async (req, res) => {
      try {
        const id = Number((req.params as { id: string }).id);
        const updates: Partial<typeof vatCompanies.$inferInsert> = {
          updatedAt: new Date(),
        };

        for (const key of ["name", "taxId", "address", "phone", "email", "bankAccount", "isActive"] as const) {
          if (req.body[key] !== undefined) {
            (updates as Record<string, unknown>)[key] = req.body[key];
          }
        }

        const [updated] = await db
          .update(vatCompanies)
          .set(updates)
          .where(eq(vatCompanies.id, id))
          .returning();

        if (!updated) {
          return res.status(404).json({ message: "VAT company not found" });
        }

        res.json({ company: serialise(updated), message: "VAT company saved" });
      } catch (error) {
        if (isMissingTable(error)) {
          return res.status(500).json({
            message: MISSING_TABLE_MESSAGE,
            suggestion: "Run npm run db:push against this database, then try again.",
          });
        }
        console.error("Error saving VAT company:", error);
        res.status(500).json({ message: "Failed to save VAT company" });
      }
    }
  );
}

export default registerVatCompanyRoutes;
