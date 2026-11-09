import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware";
import { validateBody } from "../validate";
import {
  COMPANY_FIELDS,
  companyHeaderProblemMessage,
  type CompanyFieldKey,
} from "../../shared/company";
import { CompanyError, getCompanyInfo, saveCompany } from "../company";

/**
 * Company letterhead endpoints.
 *
 * GET  /api/company  - the one row plus whether it is complete enough to print
 * PUT  /api/company  - create or update that row (never a second row)
 *
 * The GET reports incompleteness as data (`valid: false` + `missingFields`) rather than
 * as an error, because the screen header and the Company Profile form both have to
 * render on a database that has no letterhead yet. Only a document refuses to print -
 * and it does so in the browser, off the same field list this route validates with.
 */

const labelFor = (key: CompanyFieldKey): string =>
  COMPANY_FIELDS.find((field) => field.key === key)?.label ?? key;

const requiredText = (key: CompanyFieldKey, max: number) => {
  const label = labelFor(key);
  return z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);
};

const companyBodySchema = z.object({
  companyName: requiredText("companyName", 200),
  registeredAddress: requiredText("registeredAddress", 500),
  deliveryAddress: requiredText("deliveryAddress", 500),
  taxId: requiredText("taxId", 50),
});

function serialiseCompany(info: Awaited<ReturnType<typeof getCompanyInfo>>) {
  return {
    company: info.record,
    header: info.header,
    valid: info.valid,
    missingFields: info.missingFields,
    message: companyHeaderProblemMessage(info.missingFields, {
      hasRecord: info.record !== null,
    }),
  };
}

/**
 * Postgres `42P01` = "relation does not exist": the migration has not been applied to this
 * database. Reported as itself instead of a generic 500, because the fix is a command the
 * operator can run, not a retry - and a generic message made an empty-looking letterhead
 * look like user error on a screen that had never been able to save at all.
 */
function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

const MISSING_TABLE_MESSAGE =
  "The company table does not exist in this database - apply the schema (npm run db:push) and try again.";

export function registerCompanyRoutes(app: Express) {
  app.get("/api/company", requireAuth, async (_req, res) => {
    try {
      res.json(serialiseCompany(await getCompanyInfo()));
    } catch (error) {
      if (isMissingTable(error)) {
        console.error("Company table is missing - run `npm run db:push`:", error);
        return res.status(500).json({
          message: MISSING_TABLE_MESSAGE,
          suggestion: "Run npm run db:push against this database, then reload the page.",
        });
      }

      console.error("Error fetching company information:", error);
      res.status(500).json({
        message: "Failed to fetch company information",
        suggestion: "Please try again later",
      });
    }
  });

  app.put(
    "/api/company",
    requirePermission("masterData", "update"),
    validateBody(
      companyBodySchema,
      "Provide the company name, registered address, delivery address and tax ID"
    ),
    async (req, res) => {
      try {
        const record = await saveCompany(req.body);
        const info = await getCompanyInfo();

        res.json({
          ...serialiseCompany(info),
          company: record,
          message: "Company information saved",
        });
      } catch (error) {
        if (error instanceof CompanyError) {
          return res.status(error.status).json({
            message: error.message,
            suggestion: error.suggestion,
            missingFields: error.missingFields,
          });
        }

        console.error("Error saving company information:", error);
        res.status(500).json({
          message: isMissingTable(error)
            ? MISSING_TABLE_MESSAGE
            : "Failed to save company information",
          suggestion: isMissingTable(error)
            ? "Run npm run db:push against this database, then save again."
            : "Please try again later",
        });
      }
    }
  );
}

export default registerCompanyRoutes;
