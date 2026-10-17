import cron from 'node-cron';
import { config } from '../config.js';
import { todayLocal } from '../lib/dates.js';
import { Pattern } from '../schedule/pattern.model.js';
import { regenerateSessions } from '../schedule/generate.js';
import { Session } from '../sessions/session.model.js';

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

const safely = (name: string, fn: () => Promise<unknown>) => () => {
  fn().catch((e) => console.error(`job ${name} failed`, e));
};

/** Registers the recurring jobs (and runs generation once now). Called from index.ts only. */
export function startJobs(): void {
  const timezone = config.appTz;
  const generate = safely('generate', () => generateAll());
  cron.schedule('5 0 * * *', generate, { timezone });
  cron.schedule('0 * * * *', safely('missed', () => markMissed()), { timezone });
  generate();
}
