import cron from 'node-cron';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { Centre } from '../centres/centre.model.js';
import { addDays, localDateTime, todayLocal, weekdayOf } from '../lib/dates.js';
import { Patient } from '../patients/patient.model.js';
import { refreshFutureSessions } from '../schedule/generate.js';
import { Session } from '../sessions/session.model.js';
import { finaliseSnapshot } from '../sessions/service.js';
import { messagesFor } from './messages.js';
import { User } from '../auth/user.model.js';
import { sendPush } from './push.js';

/**
 * Nightly: per centre, re-applies the setup to future scheduled sessions (snapshots; this retries a refresh that
 * failed after a setup save) and tops up scheduled sessions for every patient with a plan there still holding.
 */
export async function generateAll(today: string = todayLocal()): Promise<void> {
  for (const centre of await Centre.find({}, { _id: 1 }).lean()) {
    await refreshFutureSessions(String(centre._id), today);
  }
}

/** Marks `scheduled` sessions from before the local date of `now` as missed; returns how many. */
export async function markMissed(now: Date = new Date()): Promise<number> {
  const due = await Session.find({ status: 'scheduled', date: { $lt: todayLocal(now) } }, { _id: 1 }).lean();
  let count = 0;
  for (const { _id } of due) {
    const ok = await withTransaction(async (tx) => {
      const done = await Session.findOneAndUpdate({ _id, status: 'scheduled' }, { $set: { status: 'missed' } }, { new: true, session: tx });
      if (!done) return false;
      await finaliseSnapshot(done, tx);
      return true;
    });
    if (ok) count++;
  }
  return count;
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
  const centres = await Centre.find({ _id: { $in: candidates.map((s) => s.centreId) } });
  let count = 0;
  for (const s of candidates) {
    const centre = centres.find((x) => String(x._id) === String(s.centreId));
    if (!centre) continue;
    // the session's own snapshots (kept current by the setup refresh while scheduled), never the live setup
    const start = localDateTime(s.date, s.shiftStart);
    const hours = centre.settings?.reminderHours ?? 24;
    if (now >= start || now.getTime() < start.getTime() - hours * 3_600_000) continue;
    const claimed = await Session.findOneAndUpdate(
      { _id: s._id, status: 'scheduled', reminderSentAt: null },
      { $set: { reminderSentAt: now } },
    );
    if (!claimed) continue;
    count++;
    const patient = await Patient.findById(s.patientId);
    if (!patient?.userId) continue;
    const messages = messagesFor((await User.findById(patient.userId, { language: 1 }).lean())?.language);
    try {
      await send(String(patient.userId), {
        title: messages.reminderTitle,
        body: messages.reminderBody(messages.weekdays[weekdayOf(s.date)]!, s.date, s.shiftStart, s.chairLabel),
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
