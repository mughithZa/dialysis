import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '@dialysis/shared';
import { Role } from './role.model.js';
import { seedRoles, DEFAULT_ROLES } from './roles.seed.js';

describe('roles', () => {
  it('seedRoles inserts five defaults and is idempotent', async () => {
    await seedRoles();
    await seedRoles();
    expect(await Role.countDocuments()).toBe(5);
  });
  it('seedRoles does not overwrite an edited role', async () => {
    await seedRoles();
    await Role.updateOne({ key: 'front_desk' }, { $push: { permissions: 'sessions.recordUsage' } });
    await seedRoles();
    expect((await Role.findOne({ key: 'front_desk' }))!.permissions).toContain('sessions.recordUsage');
  });
  it('centre role cannot hold a global permission', async () => {
    await expect(
      Role.create({ key: 'x', name: 'X', scope: 'centre', permissions: ['stats.global'], system: false }),
    ).rejects.toThrow(/global_perm_in_centre_role/);
  });
  it('every default permission is in the catalogue', () => {
    const keys = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const r of DEFAULT_ROLES) for (const p of r.permissions) expect(keys.has(p), `${r.key}:${p}`).toBe(true);
  });
});
