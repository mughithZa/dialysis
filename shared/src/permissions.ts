export const CATEGORIES = [
  'Centres',
  'Users & roles',
  'Patients',
  'Schedule',
  'Sessions',
  'Doctor orders',
  'Medicine & supply list',
  'Reports & audit',
  'Centre settings',
] as const;
export type Category = (typeof CATEGORIES)[number];

const def = <K extends string>(category: Category, keys: readonly K[]) =>
  keys.map((key) => ({ key, category }) as const);

export const PERMISSIONS = [
  ...def('Centres', ['centres.create', 'centres.close', 'stats.global', 'managers.manage'] as const),
  ...def('Users & roles', ['users.create', 'users.edit', 'users.resetPassword', 'roles.assign', 'roles.edit'] as const),
  ...def('Patients', [
    'patients.view', 'patients.create', 'patients.edit', 'patients.discharge', 'transfers.send', 'transfers.decide',
  ] as const),
  ...def('Schedule', [
    'schedule.view', 'schedule.book', 'schedule.makeup', 'schedule.setup', 'schedule.assignNurses',
  ] as const),
  ...def('Sessions', [
    'sessions.view', 'sessions.run', 'sessions.postpone', 'sessions.recordUsage', 'sessions.recordVitals',
    'sessions.addNotes', 'sessions.editClosed', 'sessions.viewHistory',
  ] as const),
  ...def('Doctor orders', ['orders.view', 'orders.write'] as const),
  ...def('Medicine & supply list', ['catalog.view', 'catalog.add', 'catalog.manage'] as const),
  ...def('Reports & audit', ['reports.centre', 'audit.view'] as const),
  ...def('Centre settings', ['settings.centre'] as const),
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];

export const GLOBAL_PERMISSIONS: Permission[] = [
  'centres.create', 'centres.close', 'stats.global', 'managers.manage', 'roles.edit', 'catalog.manage',
];
