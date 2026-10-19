import { describe, expect, it } from 'vitest';
import type { MeDto, Permission } from '@dialysis/shared';
import { landingPath, NAV_ITEMS, splitTabs, TAB_COUNT, visibleNav } from './nav';
import en from '../i18n/en.json';
import ar from '../i18n/ar.json';

const staff = (centrePerms: Permission[], globalPermissions: Permission[] = []): MeDto => ({
  id: 'u1',
  name: 'Staff',
  kind: 'staff',
  language: 'en',
  globalPermissions,
  centres: [{ id: 'c1', name: 'Centre 1', permissions: centrePerms }],
});

const patient: MeDto = { id: 'p1', name: 'Pat', kind: 'patient', language: 'en', globalPermissions: [], centres: [] };

const paths = (me: MeDto, centreId: string | null) => visibleNav(me, centreId).map((i) => i.to);

const NURSE: Permission[] = ['sessions.run', 'sessions.view', 'patients.view', 'schedule.view'];

describe('visibleNav', () => {
  it('shows today but not users for a nurse', () => {
    const p = paths(staff(NURSE), 'c1');
    expect(p).toContain('/c/c1/today');
    expect(p).toContain('/c/c1/patients');
    expect(p).not.toContain('/c/c1/users');
  });

  it('shows today to anyone who can view sessions, e.g. a doctor', () => {
    expect(paths(staff(['sessions.view', 'patients.view']), 'c1')).toContain('/c/c1/today');
  });

  it('does not give a front desk user today just for sessions.recordUsage', () => {
    const p = paths(staff(['patients.view', 'schedule.view', 'sessions.recordUsage']), 'c1');
    expect(p).not.toContain('/c/c1/today');
  });

  it('shows only /me to a patient', () => {
    expect(paths(patient, null)).toEqual(['/me']);
  });

  it('uses global permissions for global items and centre permissions for centre items', () => {
    const pm = staff(['users.create', 'settings.centre'], ['centres.create', 'stats.global']);
    const p = paths(pm, 'c1');
    expect(p).toEqual(expect.arrayContaining(['/centres', '/dashboard', '/c/c1/users', '/c/c1/settings']));
    expect(p).not.toContain('/roles');
  });

  it('shows transfers for either send or decide', () => {
    expect(paths(staff(['transfers.decide']), 'c1')).toContain('/c/c1/transfers');
    expect(paths(staff(['transfers.send']), 'c1')).toContain('/c/c1/transfers');
  });

  it('hides centre items when there is no current centre', () => {
    expect(paths(staff([], ['roles.edit']), null)).toEqual(['/roles']);
  });
});

describe('landingPath', () => {
  it('sends patients to /me', () => {
    expect(landingPath(patient, null)).toBe('/me');
  });
  it('sends nurse-like users to today', () => {
    expect(landingPath(staff(NURSE), 'c1')).toBe('/c/c1/today');
  });
  it('sends a doctor or front desk user with sessions.view to today', () => {
    expect(landingPath(staff(['sessions.view', 'patients.view']), 'c1')).toBe('/c/c1/today');
  });
  it('keeps no-centre users on their current landing', () => {
    expect(landingPath(staff([], ['centres.create']), null)).toBe('/centres');
  });
  it('sends others to the first visible item', () => {
    expect(landingPath(staff(['users.create', 'patients.view']), 'c1')).toBe('/c/c1/patients');
  });
});

describe('splitTabs (phone tab bar)', () => {
  const ADMIN: Permission[] = ['sessions.view', 'patients.view', 'schedule.view', 'transfers.send', 'users.create', 'settings.centre', 'audit.view', 'reports.centre'];

  it('keeps at most four tabs, everyday screens first, the rest for More', () => {
    const items = visibleNav(staff(ADMIN, ['centres.create', 'roles.edit', 'catalog.manage', 'stats.global']), 'c1');
    const { tabs, rest } = splitTabs(items);
    expect(tabs).toHaveLength(TAB_COUNT);
    expect(tabs.map((i) => i.path)).toEqual(['/c/:centreId/today', '/c/:centreId/patients', '/c/:centreId/schedule', '/dashboard']);
    expect(rest.map((i) => i.path)).toContain('/roles');
    expect([...tabs, ...rest]).toHaveLength(items.length);
  });

  it('puts everything in tabs when there are four or fewer items', () => {
    const { tabs, rest } = splitTabs(visibleNav(staff(NURSE), 'c1'));
    expect(tabs.map((i) => i.path)).toEqual(['/c/:centreId/today', '/c/:centreId/patients', '/c/:centreId/schedule']);
    expect(rest).toEqual([]);
  });

  it('gives every item an icon and a short label in both languages', () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon).toBeTruthy();
      const short = item.shortKey.replace('nav.short.', '');
      expect((en.nav.short as Record<string, string>)[short]).toBeTruthy();
      expect((ar.nav.short as Record<string, string>)[short]).toBeTruthy();
    }
  });
});
