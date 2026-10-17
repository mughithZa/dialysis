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
  const ids = [...user.globalRoleIds];
  if (centreId) {
    const m = user.memberships.find((x) => String(x.centreId) === String(centreId));
    if (m) ids.push(...m.roleIds);
  }
  if (!ids.length) return new Set();
  const roles = await Role.find({ _id: { $in: ids } });
  return new Set(roles.flatMap((r) => r.permissions as Permission[]));
}
