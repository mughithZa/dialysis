import type { ClientSession } from 'mongoose';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { todayLocal, weekdayOf } from '../lib/dates.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Session } from '../sessions/session.model.js';
import { Plan } from './plan.model.js';
import { lockCentreSchedule } from './slots.js';

export interface SetupDto {
  machines: { id: string; label: string; active: boolean }[];
  blocks: { id: string; name: string; start: string; end: string }[];
  workingDays: number[];
}

export interface BlockInput { id?: string; name: string; start: string; end: string }
export interface SetupInput { machineCount: number; blocks: BlockInput[]; workingDays: number[] }

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Equal blocks between day start and end, each rounded down to the minute; the last ends at `dayEnd`. */
export function proposeBlocks(dayStart: string, dayEnd: string, count: number): { name: string; start: string; end: string }[] {
  const a = toMin(dayStart);
  const b = toMin(dayEnd);
  return Array.from({ length: count }, (_, i) => ({
    name: `Session ${i + 1}`,
    start: toHhmm(a + Math.floor(((b - a) * i) / count)),
    end: i === count - 1 ? dayEnd : toHhmm(a + Math.floor(((b - a) * (i + 1)) / count)),
  }));
}

const numericLabel = (label: string) => (/^\d+$/.test(label) ? Number(label) : Number.POSITIVE_INFINITY);

export async function getSetup(centreId: string, session?: ClientSession): Promise<SetupDto> {
  const centre = await Centre.findById(centreId).session(session ?? null);
  if (!centre) throw notFound();
  const [chairs, shifts] = await Promise.all([
    Chair.find({ centreId, active: true }).session(session ?? null),
    Shift.find({ centreId, active: true }).session(session ?? null),
  ]);
  chairs.sort((x, y) => numericLabel(x.label) - numericLabel(y.label) || String(x._id).localeCompare(String(y._id)));
  shifts.sort((x, y) => x.start.localeCompare(y.start));
  return {
    machines: chairs.map((c) => ({ id: c.id as string, label: c.label, active: c.active })),
    blocks: shifts.map((s) => ({ id: s.id as string, name: s.name, start: s.start, end: s.end })),
    workingDays: [...centre.workingDays].sort((x, y) => x - y),
  };
}

interface Usage { chairIds: Set<string>; shiftIds: Set<string>; weekdays: Set<number> }

/**
 * What the future already uses: scheduled or active sessions from today, and the items of every plan that still
 * holds (`to` empty or ≥ today). Read inside the setup transaction.
 */
async function loadUsage(centreId: string, today: string, session: ClientSession): Promise<Usage> {
  const usage: Usage = { chairIds: new Set(), shiftIds: new Set(), weekdays: new Set() };
  const sessions = await Session.find(
    { centreId, status: { $in: ['scheduled', 'active'] }, date: { $gte: today } },
    'chairId shiftId date',
  )
    .session(session)
    .lean();
  for (const s of sessions) {
    usage.chairIds.add(String(s.chairId));
    usage.shiftIds.add(String(s.shiftId));
    usage.weekdays.add(weekdayOf(s.date));
  }
  const plans = await Plan.find({ centreId, $or: [{ to: null }, { to: { $gte: today } }] }, 'items')
    .session(session)
    .lean();
  for (const p of plans) {
    for (const it of p.items) {
      usage.chairIds.add(String(it.chairId));
      usage.shiftIds.add(String(it.shiftId));
      usage.weekdays.add(it.weekday);
    }
  }
  return usage;
}

export interface ApplyResult { dto: SetupDto; timesChanged: boolean }

export async function applySetup(centreId: string, input: SetupInput, session: ClientSession): Promise<ApplyResult> {
  // validate blocks
  const sorted = [...input.blocks].sort((x, y) => x.start.localeCompare(y.start));
  for (const b of sorted) if (b.start >= b.end) throw badRequest('validation');
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end) throw badRequest('blocks_overlap');
  const days = [...new Set(input.workingDays)];

  // first operation of the transaction: conflicts with any booking committing meanwhile (see lockCentreSchedule)
  await lockCentreSchedule(centreId, session);
  const centre = await Centre.findById(centreId).session(session);
  if (!centre) throw notFound();
  const [allChairs, activeShifts] = await Promise.all([
    Chair.find({ centreId }).session(session),
    Shift.find({ centreId, active: true }).session(session),
  ]);
  const usage = await loadUsage(centreId, todayLocal(), session);

  // machines: pick which active ones to retire / which labels to add
  const active = allChairs
    .filter((c) => c.active)
    .sort((x, y) => numericLabel(x.label) - numericLabel(y.label) || String(x._id).localeCompare(String(y._id)));
  const toRetire = active.length > input.machineCount ? active.slice(input.machineCount) : [];
  if (toRetire.some((c) => usage.chairIds.has(c.id as string))) throw conflict('in_use');

  // blocks: ids must be this centre's active blocks; missing ones are removed
  const byId = new Map(activeShifts.map((s) => [s.id as string, s]));
  const keepIds = new Set<string>();
  for (const b of input.blocks) {
    if (b.id === undefined) continue;
    if (!byId.has(b.id) || keepIds.has(b.id)) throw badRequest('validation');
    keepIds.add(b.id);
  }
  const removed = activeShifts.filter((s) => !keepIds.has(s.id as string));
  if (removed.some((s) => usage.shiftIds.has(s.id as string))) throw conflict('in_use');

  // working days
  const droppedDays = centre.workingDays.filter((d) => !days.includes(d));
  if (droppedDays.some((d) => usage.weekdays.has(d))) throw conflict('in_use');

  // ---- writes ----
  for (const c of toRetire) {
    c.active = false;
    await c.save({ session });
  }
  if (active.length < input.machineCount) {
    const have = new Set(active.map((c) => c.label));
    let need = input.machineCount - active.length;
    for (let n = 1; need > 0; n++) {
      const label = String(n);
      if (have.has(label)) continue;
      const retired = allChairs.find((c) => !c.active && c.label === label);
      if (retired) {
        retired.active = true;
        await retired.save({ session });
      } else {
        await Chair.create([{ centreId, label }], { session });
      }
      need--;
    }
  }

  let timesChanged = false;
  for (const s of removed) {
    s.active = false;
    await s.save({ session });
  }
  for (const b of input.blocks) {
    const name = b.name.trim();
    const existing = b.id === undefined ? undefined : byId.get(b.id);
    if (existing) {
      if (existing.start !== b.start || existing.end !== b.end) timesChanged = true;
      existing.set({ name, start: b.start, end: b.end });
      await existing.save({ session });
    } else {
      await Shift.create([{ centreId, name, start: b.start, end: b.end }], { session });
    }
  }
  centre.workingDays = days;
  await centre.save({ session });

  return { dto: await getSetup(centreId, session), timesChanged };
}
