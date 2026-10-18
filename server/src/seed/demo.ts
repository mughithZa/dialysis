import type { Types } from 'mongoose';
import { User } from '../auth/user.model.js';
import { seedRoles } from '../auth/roles.seed.js';
import { Role } from '../auth/role.model.js';
import { hashPassword } from '../auth/password.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Unit } from '../catalog/unit.model.js';
import { Item } from '../catalog/item.model.js';
import { Patient } from '../patients/patient.model.js';
import { bookPattern } from '../schedule/booking.js';
import { ChairAssignment } from '../schedule/assignment.model.js';
import { Pattern } from '../schedule/pattern.model.js';
import { Session } from '../sessions/session.model.js';
import { UsageLine } from '../sessions/usage.model.js';
import { addDays, localDateTime, todayLocal, weekdayOf } from '../lib/dates.js';

export const DEMO_PASSWORD = 'demo1234';
const CENTRE_NAMES = ['Al-Midan Centre', 'Bab Touma Centre'];
const UNITS = ['cc', 'ml', 'IU', 'mg', 'piece'];
const ITEMS: { name: string; type: 'medicine' | 'supply'; unit: string }[] = [
  { name: 'Heparin', type: 'medicine', unit: 'cc' },
  { name: 'EPO', type: 'medicine', unit: 'IU' },
  { name: 'Iron sucrose', type: 'medicine', unit: 'mg' },
  { name: 'Vitamin B complex', type: 'medicine', unit: 'ml' },
  { name: 'Dialyser', type: 'supply', unit: 'piece' },
  { name: 'Bloodline set', type: 'supply', unit: 'piece' },
  { name: 'AV fistula needle', type: 'supply', unit: 'piece' },
  { name: 'Acid concentrate', type: 'supply', unit: 'piece' },
  { name: 'Bicarbonate cartridge', type: 'supply', unit: 'piece' },
];

/** The CLI must be opted into explicitly so it can never touch a real database by accident. */
export function assertSeedAllowed(env: Record<string, string | undefined>): void {
  if (env.ALLOW_DEMO_SEED !== '1') throw new Error('Refusing to seed: set ALLOW_DEMO_SEED=1 to confirm.');
}

const two = (n: number) => String(n).padStart(2, '0');

/** Creates the demo dataset once; returns `created: false` when the `pm` user already exists. */
export async function seedDemo(): Promise<{ created: boolean }> {
  if (await User.exists({ username: 'pm' })) return { created: false };

  await seedRoles();
  const roles = new Map((await Role.find()).map((r) => [r.key, r._id]));
  const role = (k: string): Types.ObjectId => roles.get(k)!;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mkStaff = (username: string, name: string, extra: Partial<{ globalRoleIds: Types.ObjectId[]; memberships: { centreId: Types.ObjectId; roleIds: Types.ObjectId[] }[] }>) =>
    User.create({ username, name, passwordHash, kind: 'staff', ...extra });

  const pm = await mkStaff('pm', 'Program Manager', { globalRoleIds: [role('program_manager')] });

  // catalog
  const units = new Map<string, Types.ObjectId>();
  for (const name of UNITS) units.set(name, (await Unit.create({ name }))._id);
  const items = new Map<string, Types.ObjectId>();
  for (const i of ITEMS) {
    const item = await Item.create({ name: i.name, type: i.type, unitId: units.get(i.unit), status: 'approved', createdBy: pm._id });
    items.set(i.name, item._id);
  }

  const centres = [];
  for (const name of CENTRE_NAMES) {
    const centre = await Centre.create({ name });
    const chairs = await Chair.create(Array.from({ length: 8 }, (_, i) => ({ centreId: centre._id, label: String(i + 1) })));
    const shifts = await Shift.create([
      { centreId: centre._id, name: 'Morning', start: '07:00', end: '11:30' },
      { centreId: centre._id, name: 'Afternoon', start: '12:00', end: '16:30' },
    ]);
    centres.push({ centre, chairs, shifts });
  }

  await mkStaff('doctor', 'Doctor', {
    memberships: centres.map((c) => ({ centreId: c.centre._id, roleIds: [role('doctor')] })),
  });

  const today = todayLocal();
  const windowStart = [addDays(today, -14), `${today.slice(0, 7)}-01`].sort()[0]!; // reaches into the current month
  const usedIds = new Set<Types.ObjectId>();

  for (const [ci, { centre, chairs, shifts }] of centres.entries()) {
    const n = ci + 1;
    const at = { centreId: centre._id };
    await mkStaff(`manager${n}`, `Manager ${n}`, { memberships: [{ ...at, roleIds: [role('centre_manager')] }] });
    await mkStaff(`desk${n}`, `Front Desk ${n}`, { memberships: [{ ...at, roleIds: [role('front_desk')] }] });
    const nurseA = await mkStaff(`nurse${n}a`, `Nurse ${n}A`, { memberships: [{ ...at, roleIds: [role('nurse')] }] });
    const nurseB = await mkStaff(`nurse${n}b`, `Nurse ${n}B`, { memberships: [{ ...at, roleIds: [role('nurse')] }] });

    // standing nurse assignments: nurse A chairs 1-4, nurse B chairs 5-8, both shifts
    const nurseOfChair = (idx: number) => (idx < 4 ? nurseA : nurseB);
    await ChairAssignment.create(
      chairs.flatMap((chair, idx) =>
        shifts.map((shift) => ({ centreId: centre._id, shiftId: shift._id, chairId: chair._id, nurseId: nurseOfChair(idx)._id })),
      ),
    );

    for (let i = 0; i < 10; i++) {
      const name = `Patient ${n}-${two(i + 1)}`;
      const user = await User.create({ username: `patient${n}-${two(i + 1)}`, name, passwordHash, kind: 'patient' });
      const patient = await Patient.create({ centreId: centre._id, userId: user._id, name });

      const group = i % 2; // Sun/Tue/Thu-style alternation: Mon-Wed-Fri or Tue-Thu-Sat
      const idx = Math.floor(i / 2);
      const chairIdx = Math.floor(idx / 2);
      const shift = shifts[idx % 2]!;
      const chair = chairs[chairIdx]!;
      const weekdays = group === 0 ? [1, 3, 5] : [2, 4, 6];
      const pattern = await bookPattern(centre.id, {
        patientId: patient.id, chairId: chair.id, shiftId: shift.id, weekdays, from: today,
      });
      await Pattern.updateOne({ _id: pattern._id }, { $set: { from: windowStart } }); // the history below belongs to it

      const nurse = nurseOfChair(chairIdx);
      let k = 0;
      for (let date = windowStart; date < today; date = addDays(date, 1)) {
        if (!weekdays.includes(weekdayOf(date))) continue;
        k++;
        const start = shift.start;
        const opened = localDateTime(date, start);
        const closed = localDateTime(date, shift.end);
        const session = await Session.create({
          centreId: centre._id, patientId: patient._id, date, chairId: chair._id, shiftId: shift._id,
          status: 'completed', openedAt: opened, openedBy: nurse._id, closedAt: closed, closedBy: nurse._id,
          vitals: {
            weightBefore: 70 + i, weightAfter: 68 + i,
            bp: [{ at: opened, systolic: 130, diastolic: 80 }, { at: closed, systolic: 122, diastolic: 76 }],
          },
        });
        const lines: [string, number][] = [['Heparin', 5], ['Dialyser', 1], ['Bloodline set', 1], ['AV fistula needle', 2]];
        if ((i + k) % 3 === 0) lines.push(['EPO', 4000]);
        await UsageLine.create(
          lines.map(([item, amount]) => ({
            sessionId: session._id, centreId: centre._id, patientId: patient._id, date,
            itemId: items.get(item)!, amount, by: nurse._id,
          })),
        );
        for (const [item] of lines) usedIds.add(items.get(item)!);
      }
    }
  }
  await Item.updateMany({ _id: { $in: [...usedIds] } }, { $set: { used: true } });
  return { created: true };
}
