import { db } from "@db";
import { regions, stores, userStoreAssignments } from "@db/schema";
import { eq, inArray, sql, type SQL } from "drizzle-orm";

/**
 * Which stores a user may see.
 *
 * AI Agent Note: hierarchy levels existed only for permission checks, so every list
 * endpoint returned every store's data, and the one endpoint that did scope (sales)
 * let a ?store_id= parameter bypass the check. This module is the single source of
 * truth for read visibility.
 */
export type AccessScope =
  | { kind: 'global' }
  | { kind: 'stores'; storeIds: number[] };

export class ScopeError extends Error {
  status = 403;
  suggestion?: string;

  constructor(message = 'You do not have access to this store',
              suggestion = 'Ask an administrator to assign you to the store') {
    super(message);
    this.name = 'ScopeError';
    this.suggestion = suggestion;
  }
}

interface ScopeUser {
  id: number;
  role?: { isSystemAdmin?: boolean; hierarchyLevel?: string } | null;
}

export async function resolveScope(user: ScopeUser): Promise<AccessScope> {
  const level = user.role?.hierarchyLevel ?? 'staff';

  if (user.role?.isSystemAdmin || level === 'admin' || level === 'global_manager') {
    return { kind: 'global' };
  }

  if (level === 'regional_manager') {
    const managedRegions = await db
      .select({ id: regions.id })
      .from(regions)
      .where(eq(regions.managerUserId, user.id));

    if (managedRegions.length === 0) return { kind: 'stores', storeIds: [] };

    const regionStores = await db
      .select({ id: stores.id })
      .from(stores)
      .where(inArray(stores.regionId, managedRegions.map((r) => r.id)));

    return { kind: 'stores', storeIds: regionStores.map((s) => s.id) };
  }

  const assignments = await db
    .select({ storeId: userStoreAssignments.storeId })
    .from(userStoreAssignments)
    .where(eq(userStoreAssignments.userId, user.id));

  return { kind: 'stores', storeIds: assignments.map((a) => a.storeId) };
}

/** null means "no restriction". */
export function scopeStoreIds(scope: AccessScope): number[] | null {
  return scope.kind === 'global' ? null : scope.storeIds;
}

/**
 * WHERE fragment for a store column. Returns undefined for global scope so callers
 * can spread it into an existing condition list. An empty allow-list becomes a
 * guaranteed-false predicate, not an omitted filter - omitting it would leak data.
 */
export function scopeStoreFilter(scope: AccessScope, column: any): SQL | undefined {
  if (scope.kind === 'global') return undefined;
  if (scope.storeIds.length === 0) return sql`false`;
  return inArray(column, scope.storeIds);
}

export function scopeAllowsStore(scope: AccessScope, storeId: number | null | undefined): boolean {
  if (scope.kind === 'global') return true;
  if (storeId == null) return false;
  return scope.storeIds.includes(storeId);
}

export function scopeDenies(scope: AccessScope, storeId: number | null | undefined): boolean {
  return !scopeAllowsStore(scope, storeId);
}
