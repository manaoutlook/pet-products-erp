import { sql, inArray } from "drizzle-orm";
import { db } from "@db";
import { appSettings } from "@db/schema";
import {
  DEFAULT_INCOME_TAX_RATE,
  DEFAULT_PROFIT_MARGIN_RATE,
  DEFAULT_SERVICE_FEE_RATE,
  normaliseProfitMarginRate,
  normaliseRate,
} from "../shared/vat-margin";

/**
 * The VAT Margin Calculator's global defaults, in `app_settings`.
 *
 * A statement is computed from three numbers. Two of them are decisions of the business, not of
 * the document in front of the operator:
 *
 *   - income tax on the VAT company's profit (20% in the worksheet);
 *   - the profit margin SmartLife keeps (95%-99%);
 *   - the VAT invoice service fee, when one is charged.
 *
 * Keeping them here means the calculator opens already filled in, and two statements printed on
 * the same day cannot disagree because somebody typed 20 on one and 0.2 on the other. The
 * per-document fields (quantity, landing price, B2B price, VAT rate) are NOT settings - they come
 * from the order and its products and must never be defaulted.
 *
 * AI Agent Note: the numbers are stored as FRACTIONS (`0.2` = 20%), the same unit as
 * `sales_orders.vat_rate` and `computeVatMarginStatement()`. Only the screen converts to the
 * percentage an operator types, with `percentToRate` / `rateToPercent`.
 */

export const VAT_MARGIN_SETTING_KEYS = {
  incomeTaxRate: "vat_margin.income_tax_rate",
  profitMarginRate: "vat_margin.default_profit_margin_rate",
  serviceFeeRate: "vat_margin.default_service_fee_rate",
} as const;

export interface VatMarginSettings {
  /** Income tax charged on the VAT company's profit (fraction, 0.2 = 20%). */
  incomeTaxRate: number;
  /** Profit margin SmartLife keeps, clamped to 95%-99% (fraction). */
  profitMarginRate: number;
  /** VAT invoice service fee as a share of the sales value (fraction, 0 may). */
  serviceFeeRate: number;
}

export const DEFAULT_VAT_MARGIN_SETTINGS: VatMarginSettings = {
  incomeTaxRate: DEFAULT_INCOME_TAX_RATE,
  profitMarginRate: DEFAULT_PROFIT_MARGIN_RATE,
  serviceFeeRate: DEFAULT_SERVICE_FEE_RATE,
};

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

/** A stored value as a finite number, or `fallback` when the row is missing/unreadable. */
function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Every setting, with the defaults filled in for anything never saved.
 *
 * A missing `app_settings` table (a database that predates `npm run db:push`) is treated as
 * "nothing saved yet" rather than an error: the calculator still works on the defaults.
 */
export async function readVatMarginSettings(): Promise<VatMarginSettings> {
  try {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(
        inArray(appSettings.key, [
          VAT_MARGIN_SETTING_KEYS.incomeTaxRate,
          VAT_MARGIN_SETTING_KEYS.profitMarginRate,
          VAT_MARGIN_SETTING_KEYS.serviceFeeRate,
        ])
      );

    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return {
      incomeTaxRate: normaliseRate(
        readNumber(byKey.get(VAT_MARGIN_SETTING_KEYS.incomeTaxRate), DEFAULT_INCOME_TAX_RATE)
      ),
      // The 95%-99% rule is applied on read as well as on write, so a hand-edited row cannot
      // hand the VAT company the whole margin.
      profitMarginRate: normaliseProfitMarginRate(
        readNumber(
          byKey.get(VAT_MARGIN_SETTING_KEYS.profitMarginRate),
          DEFAULT_PROFIT_MARGIN_RATE
        )
      ),
      serviceFeeRate: normaliseRate(
        readNumber(byKey.get(VAT_MARGIN_SETTING_KEYS.serviceFeeRate), DEFAULT_SERVICE_FEE_RATE)
      ),
    };
  } catch (error) {
    if (!isMissingTable(error)) {
      console.error("Could not read the VAT margin settings:", error);
    }
    return { ...DEFAULT_VAT_MARGIN_SETTINGS };
  }
}

/**
 * Write the settings that were sent, leaving any omitted one untouched.
 *
 * `onConflictDoUpdate` rather than delete-then-insert: two operators saving at the same time must
 * not be able to leave the table half written.
 */
export async function saveVatMarginSettings(
  settings: Partial<VatMarginSettings>,
  userId: number | null = null
): Promise<VatMarginSettings> {
  const rows: { key: string; value: string }[] = [];

  if (settings.incomeTaxRate !== undefined) {
    rows.push({
      key: VAT_MARGIN_SETTING_KEYS.incomeTaxRate,
      value: String(normaliseRate(settings.incomeTaxRate)),
    });
  }
  if (settings.profitMarginRate !== undefined) {
    rows.push({
      key: VAT_MARGIN_SETTING_KEYS.profitMarginRate,
      value: String(normaliseProfitMarginRate(settings.profitMarginRate)),
    });
  }
  if (settings.serviceFeeRate !== undefined) {
    rows.push({
      key: VAT_MARGIN_SETTING_KEYS.serviceFeeRate,
      value: String(normaliseRate(settings.serviceFeeRate)),
    });
  }

  if (rows.length > 0) {
    await db
      .insert(appSettings)
      .values(rows.map((row) => ({ ...row, updatedAt: new Date(), updatedByUserId: userId })))
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: sql`excluded.value`,
          updatedAt: new Date(),
          updatedByUserId: userId,
        },
      });
  }

  return readVatMarginSettings();
}
