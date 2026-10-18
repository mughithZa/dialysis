import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { requirePatient } from '../auth/middleware.js';
import { Centre } from '../centres/centre.model.js';
import { Shift } from '../centres/shift.model.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { Patient } from '../patients/patient.model.js';
import { Session, type SessionDoc } from '../sessions/session.model.js';
import { buildTimeline } from '../sessions/timeline.js';

export const meRouter = Router();
meRouter.use(requirePatient);

async function ownPatient(userId: unknown) {
  const patient = await Patient.findOne({ userId });
  if (!patient) throw notFound();
  return patient;
}

/** Shift times and centre names for a set of sessions. */
async function lookups(sessions: SessionDoc[]) {
  const [shifts, centres] = await Promise.all([
    Shift.find({ _id: { $in: sessions.map((s) => s.shiftId) } }),
    Centre.find({ _id: { $in: sessions.map((s) => s.centreId) } }),
  ]);
  const shiftOf = (s: SessionDoc) => shifts.find((x) => String(x._id) === String(s.shiftId));
  const centreName = (s: SessionDoc) => centres.find((c) => String(c._id) === String(s.centreId))?.name ?? '';
  return { shiftOf, centreName };
}

const byDateThenStart = (start: (s: SessionDoc) => string) => (a: SessionDoc, b: SessionDoc) =>
  a.date === b.date ? start(a).localeCompare(start(b)) : a.date.localeCompare(b.date);

function mini(s: SessionDoc, l: Awaited<ReturnType<typeof lookups>>) {
  const shift = l.shiftOf(s);
  return {
    id: s.id as string,
    date: s.date,
    start: shift?.start ?? '',
    end: shift?.end ?? '',
    centreName: l.centreName(s),
    kind: s.kind,
    status: s.status,
  };
}

meRouter.get('/overview', async (req, res, next) => {
  try {
    const patient = await ownPatient(req.user!._id);
    const today = todayLocal();
    const [centre, active, scheduled] = await Promise.all([
      Centre.findById(patient.centreId),
      Session.findOne({ patientId: patient._id, status: 'active' }),
      patient.status === 'discharged'
        ? []
        : Session.find({ patientId: patient._id, status: 'scheduled', date: { $gte: today, $lte: addDays(today, 13) } }),
    ]);
    const l = await lookups([...scheduled, ...(active ? [active] : [])]);
    scheduled.sort(byDateThenStart((s) => l.shiftOf(s)?.start ?? ''));
    res.json({
      patient: { name: patient.name },
      centre: { name: centre?.name ?? '' },
      active: active ? mini(active, l) : null,
      upcoming: scheduled.map((s) => mini(s, l)),
    });
  } catch (e) {
    next(e);
  }
});

const sessionsQuery = z.object({
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

meRouter.get('/timeline', validate(sessionsQuery, 'query'), async (req, res, next) => {
  try {
    const { before, limit } = req.query as unknown as z.infer<typeof sessionsQuery>;
    const patient = await ownPatient(req.user!._id);
    const centre = await Centre.findById(patient.centreId);
    res.json(await buildTimeline(patient._id, { kind: 'patient', seeNotes: centre?.settings?.patientsSeeNotes === true }, { before, limit }));
  } catch (e) {
    next(e);
  }
});
