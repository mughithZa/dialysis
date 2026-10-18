import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { User } from '../auth/user.model.js';
import { Role } from '../auth/role.model.js';
import { seedRoles } from '../auth/roles.seed.js';
import { hashPassword } from '../auth/password.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Unit } from '../catalog/unit.model.js';
import { Item } from '../catalog/item.model.js';

export const E2E_PASSWORD = 'e2e-pass-1';

/** Minimal dataset for the browser end-to-end test: one centre, one user per role, 4 chairs, 2 shifts, 2 items. */
export async function seedE2e(): Promise<void> {
  await seedRoles();
  const roles = new Map((await Role.find()).map((r) => [r.key, r._id]));
  const passwordHash = await hashPassword(E2E_PASSWORD);

  const pm = await User.create({ username: 'pm', name: 'Program Manager', passwordHash, kind: 'staff', globalRoleIds: [roles.get('program_manager')] });
  // open every day: the browser test books "today's weekday", which must be a working day whatever the date
  const centre = await Centre.create({ name: 'E2E Centre', workingDays: [0, 1, 2, 3, 4, 5, 6] });
  await Chair.create(['1', '2', '3', '4'].map((label) => ({ centreId: centre._id, label })));
  await Shift.create([
    { centreId: centre._id, name: 'Morning', start: '07:00', end: '11:30' },
    { centreId: centre._id, name: 'Afternoon', start: '12:00', end: '16:30' },
  ]);
  const staff: [string, string, string][] = [
    ['manager', 'Centre Manager', 'centre_manager'],
    ['desk', 'Front Desk', 'front_desk'],
    ['nurse', 'Nurse Nora', 'nurse'],
    ['doctor', 'Doctor Dan', 'doctor'],
  ];
  for (const [username, name, role] of staff) {
    await User.create({ username, name, passwordHash, kind: 'staff', memberships: [{ centreId: centre._id, roleIds: [roles.get(role)] }] });
  }

  const cc = await Unit.create({ name: 'cc' });
  const iu = await Unit.create({ name: 'IU' });
  await Item.create({ name: 'Heparin', type: 'medicine', unitId: cc._id, status: 'approved', createdBy: pm._id });
  await Item.create({ name: 'EPO', type: 'medicine', unitId: iu._id, status: 'approved', createdBy: pm._id });
}

// Run directly (tsx src/seed/e2e.ts): seed the database named by MONGO_URL.
if (import.meta.url === `file://${process.argv[1]}`) {
  await connectDb(config.mongoUrl);
  try {
    await seedE2e();
    console.log('e2e data seeded');
  } finally {
    await mongoose.disconnect();
  }
}
