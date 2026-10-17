import type { Types } from 'mongoose';
import type { Permission } from '@dialysis/shared';
import { Role } from './role.model.js';

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
