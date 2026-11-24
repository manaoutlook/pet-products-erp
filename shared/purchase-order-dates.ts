import { vietnamDayOf } from "./vietnam-day";

/**
 * Back-dating a purchase order.
 *
 * The expected delivery date is not decoration: the register reports an order as overdue from
 * that date, and every goods receipt is compared against it to say how late the shipment was.
 * Entering an order *after* the goods arrived is normal bookkeeping (the paper invoice turns up
 * days later), but it is an administrator's call, not something each user can do - otherwise the
 * overdue report can be made to say anything.
 *
 * The rule lives here so the dialog that hides the option (`CreatePurchaseOrderDialog`) and the
 * endpoint that enforces it (`POST /api/purchase-orders`) cannot drift apart. Days are Vietnamese
 * calendar days, the same unit the finance screens use, so "today" does not depend on the
 * server's or the browser's timezone.
 */

export const BACK_DATED_PURCHASE_ORDER_MESSAGE =
  "Only an administrator can back-date a purchase order";

/**
 * Is `deliveryDate` before today? An unparsable date is not "back-dated" - the shape is checked
 * by the schema before this is asked, so answering `false` here keeps the two concerns separate.
 */
export function isBackDatedPurchaseOrderDate(
  deliveryDate: Date | string,
  now: Date = new Date(),
): boolean {
  const day = vietnamDayOf(deliveryDate);
  if (!day) return false;
  return day < vietnamDayOf(now);
}

/** Today's Vietnamese day (`YYYY-MM-DD`) - the earliest day a non-administrator may choose. */
export function todayInVietnam(now: Date = new Date()): string {
  return vietnamDayOf(now);
}
