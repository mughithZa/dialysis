import type { MeDto, Permission } from '@dialysis/shared';
import { useAuth, useCentre } from './AuthProvider';

/** Pure check: global permissions, plus the given centre's permissions when a centre is given. */
export function hasPerm(me: MeDto | null, perm: Permission, centreId: string | null): boolean {
  if (!me) return false;
  if (me.globalPermissions.includes(perm)) return true;
  const centre = centreId ? me.centres.find((c) => c.id === centreId) : undefined;
  return centre?.permissions.includes(perm) ?? false;
}

/** `centreId` defaults to the current centre. */
export function useCan(perm: Permission, centreId?: string): boolean {
  const { me } = useAuth();
  const current = useCentre().centreId;
  return hasPerm(me, perm, centreId ?? current);
}
