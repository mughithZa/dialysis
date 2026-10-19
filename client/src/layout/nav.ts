import type { MeDto, Permission } from '@dialysis/shared';
import {
  IconAdjustmentsHorizontal,
  IconArrowsExchange,
  IconBuildingHospital,
  IconCalendarWeek,
  IconChartBar,
  IconChartPie,
  IconHeartbeat,
  IconHistory,
  IconHome,
  IconPill,
  IconSettings,
  IconShieldLock,
  IconUserCog,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { hasPerm } from '../auth/useCan';

export interface NavItem {
  /** Route pattern; `:centreId` is filled in for centre-scoped items. */
  path: string;
  labelKey: string;
  /** Short label for the phone tab bar. */
  shortKey: string;
  icon: Icon;
  /** Any one of these permissions grants access; `'patient'` means patient accounts only. */
  perm: Permission | 'patient' | (Permission | 'patient')[];
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/centres', labelKey: 'nav.centres', shortKey: 'nav.short.centres', icon: IconBuildingHospital, perm: 'centres.create' },
  { path: '/roles', labelKey: 'nav.roles', shortKey: 'nav.short.roles', icon: IconShieldLock, perm: 'roles.edit' },
  { path: '/catalog', labelKey: 'nav.catalog', shortKey: 'nav.short.catalog', icon: IconPill, perm: 'catalog.manage' },
  { path: '/dashboard', labelKey: 'nav.dashboard', shortKey: 'nav.short.dashboard', icon: IconChartPie, perm: 'stats.global' },
  { path: '/c/:centreId/today', labelKey: 'nav.today', shortKey: 'nav.short.today', icon: IconHeartbeat, perm: 'sessions.view' },
  { path: '/c/:centreId/patients', labelKey: 'nav.patients', shortKey: 'nav.short.patients', icon: IconUsers, perm: 'patients.view' },
  { path: '/c/:centreId/schedule', labelKey: 'nav.schedule', shortKey: 'nav.short.schedule', icon: IconCalendarWeek, perm: 'schedule.view' },
  { path: '/c/:centreId/transfers', labelKey: 'nav.transfers', shortKey: 'nav.short.transfers', icon: IconArrowsExchange, perm: ['transfers.send', 'transfers.decide'] },
  { path: '/c/:centreId/users', labelKey: 'nav.users', shortKey: 'nav.short.users', icon: IconUserCog, perm: 'users.create' },
  { path: '/c/:centreId/setup', labelKey: 'nav.setup', shortKey: 'nav.short.setup', icon: IconAdjustmentsHorizontal, perm: 'schedule.setup' },
  { path: '/c/:centreId/settings', labelKey: 'nav.settings', shortKey: 'nav.short.settings', icon: IconSettings, perm: 'settings.centre' },
  { path: '/c/:centreId/audit', labelKey: 'nav.audit', shortKey: 'nav.short.audit', icon: IconHistory, perm: 'audit.view' },
  { path: '/c/:centreId/stats', labelKey: 'nav.stats', shortKey: 'nav.short.stats', icon: IconChartBar, perm: 'reports.centre' },
  { path: '/me', labelKey: 'nav.me', shortKey: 'nav.short.me', icon: IconHome, perm: 'patient' },
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

/** Phone tab bar priority: the screens people use all day come first; everything else goes in "More". */
const TAB_PRIORITY = [
  '/c/:centreId/today',
  '/me',
  '/c/:centreId/patients',
  '/c/:centreId/schedule',
  '/dashboard',
  '/centres',
  '/c/:centreId/transfers',
  '/c/:centreId/stats',
  '/c/:centreId/users',
];
export const TAB_COUNT = 4;

/** Splits the visible items into at most four phone tabs (by priority) and the rest for the "More" sheet. */
export function splitTabs(items: VisibleNavItem[]): { tabs: VisibleNavItem[]; rest: VisibleNavItem[] } {
  const rank = (i: VisibleNavItem) => {
    const r = TAB_PRIORITY.indexOf(i.path);
    return r === -1 ? TAB_PRIORITY.length : r;
  };
  const tabs = [...items].sort((a, b) => rank(a) - rank(b)).slice(0, TAB_COUNT);
  return { tabs, rest: items.filter((i) => !tabs.includes(i)) };
}

/** Where to send a user after login: patient -> /me, nurse-like -> today, else the first visible item. */
export function landingPath(me: MeDto, centreId: string | null): string {
  if (me.kind === 'patient') return '/me';
  const items = visibleNav(me, centreId);
  const today = items.find((i) => i.path.endsWith('/today'));
  return (today ?? items[0])?.to ?? '/me';
}
