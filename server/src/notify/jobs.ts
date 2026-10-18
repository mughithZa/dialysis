import cron from 'node-cron';
import { config } from '../config.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { addDays, localDateTime, todayLocal, weekdayOf } from '../lib/dates.js';
import { Patient } from '../patients/patient.model.js';
import { Pattern } from '../schedule/pattern.model.js';
import { regenerateSessions } from '../schedule/generate.js';
import { Session } from '../sessions/session.model.js';
import { messages } from './messages.js';
import { sendPush } from './push.js';

/** Tops up scheduled sessions for every open pattern. */
export async function generateAll(today: string = todayLocal()): Promise<void> {
  const patients = await Pattern.distinct('patientId', { to: null });
  for (const patientId of patients) {
    await regenerateSessions(String(patientId), today);
  }
}

/** Marks `scheduled` sessions from before the local date of `now` as missed; returns how many. */
export async function markMissed(now: Date = new Date()): Promise<number> {
  const res = await Session.updateMany(
    { status: 'scheduled', date: { $lt: todayLocal(now) } },
    { $set: { status: 'missed' } },
  );
  return res.modifiedCount;
}

/**
 * Sends the reminder for every scheduled session whose reminder window (start - reminderHours <= now < start)
 * is open and has not been sent yet; returns how many were claimed. The claim is atomic so concurrent runs
 * cannot double-send, and a session is consumed even if the patient has no subscription (idempotent job).
 */
export async function sendDueReminders(now: Date = new Date(), send: typeof sendPush = sendPush): Promise<number> {
  const today = todayLocal(now);
  const candidates = await Session.find({
    status: 'scheduled',
    reminderSentAt: null,
    date: { $gte: today, $lte: addDays(today, 4) },
  });
  if (!candidates.length) return 0;
  const [shifts, centres] = await Promise.all([
    Shift.find({ _id: { $in: candidates.map((s) => s.shiftId) } }),
    Centre.find({ _id: { $in: candidates.map((s) => s.centreId) } }),
  ]);
  let count = 0;
  for (const s of candidates) {
    const shift = shifts.find((x) => String(x._id) === String(s.shiftId));
    const centre = centres.find((x) => String(x._id) === String(s.centreId));
    if (!shift || !centre) continue;
    const start = localDateTime(s.date, shift.start);
    const hours = centre.settings?.reminderHours ?? 24;
    if (now >= start || now.getTime() < start.getTime() - hours * 3_600_000) continue;
    const claimed = await Session.findOneAndUpdate(
      { _id: s._id, status: 'scheduled', reminderSentAt: null },
      { $set: { reminderSentAt: now } },
    );
    if (!claimed) continue;
    count++;
    const [patient, chair] = await Promise.all([Patient.findById(s.patientId), Chair.findById(s.chairId)]);
    if (!patient?.userId) continue;
    try {
      await send(String(patient.userId), {
        title: messages.reminderTitle,
        body: messages.reminderBody(messages.weekdays[weekdayOf(s.date)]!, s.date, shift.start, chair?.label ?? ''),
        url: '/me',
      });
    } catch (e) {
      console.error('reminder send failed', e);
    }
  }
  return count;
}

const safely = (name: string, fn: () => Promise<unknown>) => () => {
  fn().catch((e) => console.error(`job ${name} failed`, e));
};

/** Registers the recurring jobs (and runs generation once now). Called from index.ts only. */
export function startJobs(): void {
  const timezone = config.appTz;
  const generate = safely('generate', () => generateAll());
  cron.schedule('5 0 * * *', generate, { timezone });
  cron.schedule('0 * * * *', safely('missed', () => markMissed()), { timezone });
  cron.schedule('*/10 * * * *', safely('reminders', () => sendDueReminders()), { timezone });
  generate();
}
