# Step 07 — Scope reads by the user's store / region

**Priority:** P0 (last, because it is the largest) · **Risk:** high · **New dependencies:** none
**Files:** `server/scoping.ts` (new), `server/routes.ts`,
`tests/backend/api/scoping.test.ts` (new)

---

## 1. Problem

The data model already supports hierarchy — `roles.hierarchyLevel`
(`staff` / `regional_manager` / `global_manager` / `admin`), `regions.managerUserId`,
`stores.regionId`, `user_store_assignments` — but the hierarchy is only consulted for
*permission* checks (`server/middleware.ts:78-110`), never to *filter rows*.

Verified consequences:

**1. A query parameter defeats the store scoping.** `server/routes.ts:3813-3841`:

```ts
if (store_id) {
  const storeIdNum = parseInt(store_id);
  if (!isNaN(storeIdNum)) {
    whereConditions.push(eq(salesTransactions.storeId, storeIdNum));   // no scope check
  }
} else {
  const userAssignments = await db.query.userStoreAssignments.findMany({
    where: eq(userStoreAssignments.userId, user.id),
  });
  ...  // only the *unfiltered* branch is scoped
}
```

A cashier assigned to store 3 can call `GET /api/sales-transactions?store_id=1` and read store
1's receipts. The scoping exists, but only on the branch nobody passes a filter to.

**2. Most lists are not scoped at all.** e.g. `GET /api/purchase-orders` (`routes.ts:381`) calls
`db.query.purchaseOrders.findMany()` — every user sees every region's orders. The same pattern
repeats for transfers, customers, dashboards and reports.

**3. The scoping that exists is copy-pasted.** The `userStoreAssignments` + `or(storeId IN …,
cashierUserId = user.id)` block is re-implemented by hand in several handlers (`3813`, `4308`,
`4445`, …) — which is exactly why one of them forgot to apply it.

---

## 2. Design

One module, `server/scoping.ts`, answering a single question — *which stores may this user see?* —
and returning a value every list endpoint applies the same way.

```ts
type AccessScope =
  | { kind: 'global' }                        // every store
  | { kind: 'stores'; storeIds: number[] };   // explicit allow-list
```

`region` collapses into `stores` (a regional manager's visible stores are the stores of the region
they manage), so there is one code path and one place to be wrong.

Three rules:

1. **`admin` / `global_manager`** (or `role.isSystemAdmin`) → `global`.
2. **`regional_manager`** → all stores whose `regionId` belongs to a region they manage
   (`regions.managerUserId = user.id`); empty list if they manage none.
3. **everyone else** → stores in `user_store_assignments`; empty list if none.

Helpers: `scopeStoreIds`, `scopeStoreFilter`, `scopeAllowsStore`, `scopeDenies`, plus a
`ScopeError` (`status: 403`).

Then apply **in phases** — never all at once:

| Phase | Work |
| --- | --- |
| 0 | Add `server/scoping.ts` + tests. No route changes. |
| 1 | Fix the `store_id` bypass and scope `GET /api/sales-transactions`. |
| 2 | Scope `GET /api/purchase-orders`, transfers, inventory lists. |
| 3 | Scope dashboard / report aggregates — the ones a manager actually cares about. |
| 4 | Guard detail reads and writes with `scopeAllowsStore` (403, not 404). |

Commit per phase; the app stays correct at every boundary, which matters because a mistake here
silently hides data from the people who need it.

---

## 3. Implementation

### 3a. `server/scoping.ts` (new)

```ts
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
```

> Use `inArray()` rather than `sql\`${col} IN ${ids}\`` — the hand-built template appears in
> several handlers today and depends on drizzle expanding a JS array correctly; `inArray` also
> refuses an empty list, which is the case you must not silently ignore.

### 3b. Phase 1 — close the `store_id` bypass

In `GET /api/sales-transactions`, resolve the scope once and use it for **both** branches:

```ts
      const scope = await resolveScope(user);

      if (store_id) {
        const storeIdNum = parseInt(store_id, 10);
        if (Number.isNaN(storeIdNum)) {
          return res.status(400).json({
            message: "Invalid store filter",
            suggestion: "store_id must be a number"
          });
        }
        // AI Agent Note: ?store_id= used to replace the user's scope entirely, so any
        // cashier could read another store's receipts by editing the URL.
        if (scopeDenies(scope, storeIdNum)) {
          return res.status(403).json({
            message: "You do not have access to that store",
            suggestion: "Choose one of your assigned stores"
          });
        }
        whereConditions.push(eq(salesTransactions.storeId, storeIdNum));
      } else {
        const storeFilter = scopeStoreFilter(scope, salesTransactions.storeId);
        if (storeFilter) whereConditions.push(storeFilter);
      }
```

If the business rule “a cashier always sees their own sales” is wanted, keep it as
`or(storeFilter, eq(salesTransactions.cashierUserId, user.id))` — do **not** let it replace the
store filter silently.

Import at the top of `routes.ts`:

```ts
import { resolveScope, scopeDenies, scopeStoreFilter } from "./scoping";
```

### 3c. Phases 2-4 patterns

**List endpoints** (purchase orders, transfers, inventory):

```ts
      const scope = await resolveScope(user);
      const conditions = [];
      const storeFilter = scopeStoreFilter(scope, purchaseOrders.destinationStoreId);
      if (storeFilter) conditions.push(storeFilter);
      ...
      const rows = await db.query.purchaseOrders.findMany({
        where: conditions.length ? and(...conditions) : undefined,
        ...
      });
```

**Detail / mutation endpoints:**

```ts
      if (scopeDenies(scope, order.destinationStoreId)) {
        return res.status(403).json({
          message: "You do not have access to this order",
          suggestion: "Ask an administrator to assign you to the store"
        });
      }
```

**Aggregates** (dashboard / reports) must apply the same filter before summing — otherwise totals
leak other stores even when the lists do not. Every `db.select({ total: sum(...) })` needs the
`storeFilter` inside its `where`.

**Writes:** a sale already derives `storeId` from the caller's assignment (step 03), and transfers
carry a source/destination store — validate both against the scope before mutating.

---

## 4. Tests — `tests/backend/api/scoping.test.ts` (new)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { regions, roles, stores, userStoreAssignments, users } from '../../../db/schema';
import { cleanDatabase, resetSequences, seedTestData } from '../../helpers/test-db';
import {
  resolveScope, scopeAllowsStore, scopeDenies, scopeStoreFilter, scopeStoreIds,
} from '../../../server/scoping';

const allPermissions = {
  products: { create: true, read: true, update: true, delete: true },
  orders: { create: true, read: true, update: true, delete: true },
  inventory: { create: true, read: true, update: true, delete: true },
  users: { create: true, read: true, update: true, delete: true },
  stores: { create: true, read: true, update: true, delete: true },
  masterData: { create: true, read: true, update: true, delete: true },
  pos: { create: true, read: true, update: true, delete: true },
  receipts: { create: true, read: true, update: true, delete: true },
};

describe('resolveScope', () => {
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let regionalManagerId: number;

  beforeEach(async () => {
    await cleanDatabase();
    await resetSequences();
    data = await seedTestData();

    const [region] = await db.insert(regions).values({ name: 'North' }).returning();

    const [regionalRole] = await db.insert(roles).values({
      name: 'regional_manager_test',
      isSystemAdmin: false,
      hierarchyLevel: 'regional_manager',
      permissions: allPermissions,
    }).returning();

    const [manager] = await db.insert(users).values({
      username: 'regional_test',
      password: 'x',
      roleId: regionalRole.id,
    }).returning();
    regionalManagerId = manager.id;

    await db.update(regions).set({ managerUserId: manager.id }).where(eq(regions.id, region.id));
    await db.update(stores).set({ regionId: region.id }).where(eq(stores.id, data.stores.store1.id));
  });

  it('gives admins an unrestricted scope', async () => {
    const scope = await resolveScope({
      id: data.users.admin.id,
      role: { isSystemAdmin: true, hierarchyLevel: 'admin' },
    });
    expect(scope.kind).toBe('global');
    expect(scopeStoreIds(scope)).toBeNull();
    expect(scopeStoreFilter(scope, stores.id)).toBeUndefined();
  });

  it('gives a regional manager only the stores of their region', async () => {
    const scope = await resolveScope({
      id: regionalManagerId,
      role: { isSystemAdmin: false, hierarchyLevel: 'regional_manager' },
    });
    expect(scope).toEqual({ kind: 'stores', storeIds: [data.stores.store1.id] });
    expect(scopeAllowsStore(scope, data.stores.store1.id)).toBe(true);
    expect(scopeDenies(scope, data.stores.warehouse.id)).toBe(true);
  });

  it('gives staff only their assigned stores', async () => {
    await db.insert(userStoreAssignments).values({
      userId: data.users.manager.id,
      storeId: data.stores.store1.id,
    });
    const scope = await resolveScope({
      id: data.users.manager.id,
      role: { isSystemAdmin: false, hierarchyLevel: 'staff' },
    });
    expect(scopeStoreIds(scope)).toEqual([data.stores.store1.id]);
  });

  it('gives a user with no assignment an empty scope, not a global one', async () => {
    const scope = await resolveScope({
      id: data.users.manager.id,
      role: { isSystemAdmin: false, hierarchyLevel: 'staff' },
    });
    expect(scopeStoreIds(scope)).toEqual([]);
    expect(scopeDenies(scope, data.stores.store1.id)).toBe(true);
  });
});
```

---

## 5. Verification

```bash
npx vitest run tests/backend/api/scoping.test.ts
npx vitest run tests/backend/api          # all backend suites - nothing else may regress
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run dev
```

Manual checks per phase:

1. Log in as **staff** assigned to store 1 → the receipts list shows only store 1.
2. Append `?store_id=<other store>` to that API call → `403 You do not have access to that store`.
3. Log in as a **regional manager** → sees every store in their region, nothing from others.
4. Log in as **admin** → sees everything (scope `global`, no filter added).
5. A user with **no assignment** sees empty lists, not everything — this is the regression that
   matters most: an empty allow-list must never degrade into “no filter”.

---

## 6. Rollback

Phase 0 is additive. Phases 1-4 revert per commit:

```bash
git revert <phase commit>
```

Never “temporarily” disable `resolveScope` by returning `{ kind: 'global' }` — that switches the
whole model off silently. Revert the commit instead.

---

## 7. Done criteria

- [ ] `server/scoping.ts` exists and is the only place that decides store visibility
- [ ] `GET /api/sales-transactions?store_id=<foreign>` answers 403
- [ ] Purchase orders, transfers and inventory lists are filtered for non-global users
- [ ] Dashboard / report aggregates use the same filter (spot-check one total against its list)
- [ ] An unassigned staff user sees empty lists, never everything
- [ ] 4 new tests pass, all backend suites pass, tsc count unchanged
