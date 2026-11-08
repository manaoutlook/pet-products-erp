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
