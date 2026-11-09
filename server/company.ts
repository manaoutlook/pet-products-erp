import { eq } from "drizzle-orm";
import { db } from "@db";
import { company } from "@db/schema";
import {
  COMPANY_SINGLETON_ID,
  companyHeaderProblemMessage,
  missingCompanyFields,
  toCompanyHeader,
  type CompanyHeader,
} from "../shared/company";

/**
 * The company letterhead, server side.
 *
 * This module is the only place the `company` row is read or written. The API routes and
 * any future server-rendered document both come through here, so "which company is this
 * document from?" has exactly one answer and the answer is never cached in a second table.
 */

export type CompanyRecord = typeof company.$inferSelect;

export interface CompanyInfo {
  record: CompanyRecord | null;
  header: CompanyHeader | null;
  missingFields: string[];
  valid: boolean;
}

/** A refusal to produce a document, with everything the caller needs to explain why. */
export class CompanyError extends Error {
  readonly status: number;
  readonly missingFields: string[];
  readonly suggestion: string;

  constructor(
    message: string,
    options: { status?: number; missingFields?: string[]; suggestion?: string } = {}
  ) {
    super(message);
    this.name = "CompanyError";
    this.status = options.status ?? 422;
    this.missingFields = options.missingFields ?? [];
    this.suggestion =
      options.suggestion ?? "Open Company Profile, complete the letterhead, then try again.";
  }
}

/** The single row, or null on a database that has never been set up. */
export async function findCompanyRecord(
  database: typeof db = db
): Promise<CompanyRecord | null> {
  const [record] = await database
    .select()
    .from(company)
    .where(eq(company.id, COMPANY_SINGLETON_ID))
    .limit(1);

  return record ?? null;
}

export async function getCompanyInfo(database: typeof db = db): Promise<CompanyInfo> {
  const record = await findCompanyRecord(database);
  const header = record ? toCompanyHeader(record) : null;
  const missingFields = missingCompanyFields(header);

  return { record, header, missingFields, valid: missingFields.length === 0 };
}

/**
 * The letterhead a document must carry, or a `CompanyError` naming the blank fields.
 *
 * Documents call this instead of reading the row directly: a missing or half-filled
 * letterhead is a validation failure, not a document with blanks in the header.
 */
export async function getCompanyHeader(
  database: typeof db = db
): Promise<CompanyHeader> {
  const { header, missingFields } = await getCompanyInfo(database);

  if (missingFields.length > 0) {
    throw new CompanyError(
      companyHeaderProblemMessage(missingFields, { hasRecord: header !== null }),
      { missingFields }
    );
  }

  return header as CompanyHeader;
}

/**
 * Create or update the one row.
 *
 * `onConflictDoUpdate` on the pinned primary key is what keeps the table a singleton in
 * practice as well as in the CHECK: a second PUT edits the same row rather than failing
 * or appending.
 */
export async function saveCompany(
  values: CompanyHeader,
  database: typeof db = db
): Promise<CompanyRecord> {
  const header = toCompanyHeader(values) as CompanyHeader;
  const missingFields = missingCompanyFields(header);

  if (missingFields.length > 0) {
    throw new CompanyError(
      `Company letterhead is incomplete - missing ${missingFields.join(", ")}`,
      { status: 400, missingFields }
    );
  }

  const [record] = await database
    .insert(company)
    .values({ id: COMPANY_SINGLETON_ID, ...header, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: company.id,
      set: { ...header, updatedAt: new Date() },
    })
    .returning();

  return record;
}
