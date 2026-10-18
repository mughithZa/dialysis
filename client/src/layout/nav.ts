import type { MeDto, Permission } from '@dialysis/shared';
import { hasPerm } from '../auth/useCan';

export interface NavItem {
  /** Route pattern; `:centreId` is filled in for centre-scoped items. */
  path: string;
  labelKey: string;
  /** Any one of these permissions grants access; `'patient'` means patient accounts only. */
  perm: Permission | 'patient' | (Permission | 'patient')[];
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/centres', labelKey: 'nav.centres', perm: 'centres.create' },
  { path: '/roles', labelKey: 'nav.roles', perm: 'roles.edit' },
  { path: '/catalog', labelKey: 'nav.catalog', perm: 'catalog.manage' },
  { path: '/dashboard', labelKey: 'nav.dashboard', perm: 'stats.global' },
  { path: '/c/:centreId/today', labelKey: 'nav.today', perm: 'sessions.run' },
  { path: '/c/:centreId/patients', labelKey: 'nav.patients', perm: 'patients.view' },
  { path: '/c/:centreId/schedule', labelKey: 'nav.schedule', perm: 'schedule.view' },
  { path: '/c/:centreId/transfers', labelKey: 'nav.transfers', perm: ['transfers.send', 'transfers.decide'] },
  { path: '/c/:centreId/users', labelKey: 'nav.users', perm: 'users.create' },
  { path: '/c/:centreId/setup', labelKey: 'nav.setup', perm: 'schedule.setup' },
  { path: '/c/:centreId/settings', labelKey: 'nav.settings', perm: 'settings.centre' },
  { path: '/c/:centreId/audit', labelKey: 'nav.audit', perm: 'audit.view' },
  { path: '/c/:centreId/stats', labelKey: 'nav.stats', perm: 'reports.centre' },
  { path: '/me', labelKey: 'nav.me', perm: 'patient' },
];

export interface VisibleNavItem extends NavItem {
  /** Concrete link target with the centre id filled in. */
  to: string;
}

export function visibleNav(me: MeDto | null, centreId: string | null): VisibleNavItem[] {
  if (!me) return [];
  const result: VisibleNavItem[] = [];
  for (const item of NAV_ITEMS) {
    const scoped = item.path.includes(':centreId');
    if (scoped && !centreId) continue;
    const perms = Array.isArray(item.perm) ? item.perm : [item.perm];
    const allowed = perms.some((p) => (p === 'patient' ? me.kind === 'patient' : hasPerm(me, p, centreId)));
    if (allowed) result.push({ ...item, to: centreId ? item.path.replace(':centreId', centreId) : item.path });
  }
  return result;
}

/** Where to send a user after login: patient -> /me, nurse-like -> today, else the first visible item. */
export function landingPath(me: MeDto, centreId: string | null): string {
  if (me.kind === 'patient') return '/me';
  const items = visibleNav(me, centreId);
  const today = items.find((i) => i.path.endsWith('/today'));
  return (today ?? items[0])?.to ?? '/me';
}
