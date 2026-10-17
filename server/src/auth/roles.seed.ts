import { GLOBAL_PERMISSIONS, type Permission } from '@dialysis/shared';
import { Role } from './role.model.js';

interface DefaultRole { key: string; name: string; scope: 'global' | 'centre'; permissions: Permission[] }

export const DEFAULT_ROLES: DefaultRole[] = [
  { key: 'program_manager', name: 'Program manager', scope: 'global', permissions: [...GLOBAL_PERMISSIONS] },
  {
    key: 'centre_manager', name: 'Centre manager', scope: 'centre',
    permissions: [
      'patients.view', 'schedule.view', 'schedule.setup', 'sessions.view', 'sessions.editClosed',
      'sessions.viewHistory', 'orders.view', 'catalog.view', 'users.create', 'users.edit',
      'users.resetPassword', 'roles.assign', 'reports.centre', 'audit.view', 'settings.centre',
    ],
  },
  {
    key: 'front_desk', name: 'Front desk', scope: 'centre',
    permissions: [
      'patients.view', 'patients.create', 'patients.edit', 'patients.discharge', 'transfers.send',
      'transfers.decide', 'schedule.view', 'schedule.book', 'schedule.makeup', 'schedule.assignNurses',
      'sessions.view', 'sessions.postpone', 'users.create', 'users.resetPassword', 'catalog.view', 'catalog.add',
    ],
  },
  {
    key: 'nurse', name: 'Nurse', scope: 'centre',
    permissions: [
      'patients.view', 'schedule.view', 'sessions.view', 'sessions.run', 'sessions.postpone',
      'sessions.recordUsage', 'sessions.recordVitals', 'sessions.addNotes', 'sessions.editClosed',
      'sessions.viewHistory', 'orders.view', 'catalog.view', 'catalog.add',
    ],
  },
  {
    key: 'doctor', name: 'Doctor', scope: 'centre',
    permissions: [
      'patients.view', 'sessions.view', 'sessions.viewHistory', 'orders.view', 'orders.write',
      'catalog.view', 'catalog.add',
    ],
  },
];

/** Inserts any missing default role; never overwrites existing (possibly edited) ones. */
export async function seedRoles(): Promise<void> {
  for (const r of DEFAULT_ROLES) {
    await Role.updateOne({ key: r.key }, { $setOnInsert: { ...r, system: true } }, { upsert: true });
  }
}
