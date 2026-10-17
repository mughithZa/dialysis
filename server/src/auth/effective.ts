import type { Types } from 'mongoose';
import type { Permission } from '@dialysis/shared';
import { Role } from './role.model.js';
import { Centre } from '../centres/centre.model.js';

/** Minimal structural shape of the User document (defined fully in Task 3). */
export interface UserPermSource {
  globalRoleIds: Types.ObjectId[];
  memberships: { centreId: Types.ObjectId | string; roleIds: Types.ObjectId[] }[];
}

/** Union of the user's global roles plus, if centreId given, their roles in that centre. */
export async function effectivePermissions(
  user: UserPermSource,
  centreId: string | null,
): Promise<Set<Permission>> {
  const m = centreId ? user.memberships.find((x) => String(x.centreId) === String(centreId)) : undefined;
  const ids = [...user.globalRoleIds, ...(m?.roleIds ?? [])];
  if (!ids.length) return new Set();
  const roles = await Role.find({ _id: { $in: ids } });
  const globalIds = new Set(user.globalRoleIds.map(String));
  // Defence in depth: a global-scope role never counts via a centre membership.
  const usable = roles.filter((r) => r.scope === 'centre' || globalIds.has(String(r._id)));
  return new Set(usable.flatMap((r) => r.permissions as Permission[]));
}

/** True if a global role grants `perm`, or any membership in an active centre does. */
export async function hasPermAnywhere(user: UserPermSource, perm: Permission): Promise<boolean> {
  if ((await effectivePermissions(user, null)).has(perm)) return true;
  const centreIds = user.memberships.map((m) => m.centreId);
  if (!centreIds.length) return false;
  const active = new Set((await Centre.find({ _id: { $in: centreIds }, status: 'active' }, { _id: 1 })).map((c) => String(c._id)));
  for (const m of user.memberships) {
    if (active.has(String(m.centreId)) && (await effectivePermissions(user, String(m.centreId))).has(perm)) return true;
  }
  return false;
}
