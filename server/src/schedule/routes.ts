import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { DISCHARGE_REASONS } from '../patients/patient.model.js';
import { loadPatientInCentre } from '../patients/load.js';
import { validate } from '../lib/validate.js';
import mongoose from 'mongoose';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { todayLocal } from '../lib/dates.js';
import { Role } from '../auth/role.model.js';
import { User } from '../auth/user.model.js';
import { Session } from '../sessions/session.model.js';
import { ChairAssignment } from './assignment.model.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { bookPattern, changePattern, endPatterns } from './booking.js';
import { Pattern, type PatternDoc } from './pattern.model.js';
import { Slot } from './slot.model.js';

export const scheduleRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid);

const patternBody = z.object({
  chairId: z.string().min(1),
  shiftId: z.string().min(1),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(3)
    .refine((w) => new Set(w).size === w.length),
  from: localDate,
});

const patternDto = (p: PatternDoc) => ({
  id: p.id as string,
  patientId: String(p.patientId),
  chairId: String(p.chairId),
  shiftId: String(p.shiftId),
  weekdays: p.weekdays,
  from: p.from,
  to: p.to ?? null,
});

scheduleRouter.get('/schedule/grid', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const [chairs, shifts, slots] = await Promise.all([
      Chair.find({ centreId }).sort({ label: 1 }),
      Shift.find({ centreId }).sort({ start: 1 }),
      Slot.find({ centreId }),
    ]);
    const patterns = await Pattern.find({ _id: { $in: slots.map((s) => s.patternId) } });
    const patients = await Patient.find({ _id: { $in: patterns.map((p) => p.patientId) } });
    const patientOfPattern = new Map(
      patterns.map((p) => [String(p._id), patients.find((pt) => String(pt._id) === String(p.patientId))]),
    );
    res.json({
      chairs: chairs.map((c) => ({ id: c.id as string, label: c.label, active: c.active })),
      shifts: shifts.map((s) => ({ id: s.id as string, name: s.name, start: s.start, end: s.end, active: s.active })),
      slots: slots.flatMap((s) => {
        const patient = patientOfPattern.get(String(s.patternId));
        return patient
          ? [{ chairId: String(s.chairId), shiftId: String(s.shiftId), weekday: s.weekday, patient: { id: patient.id as string, name: patient.name } }]
          : [];
      }),
    });
  } catch (e) {
    next(e);
  }
});

scheduleRouter.post(
  '/patients/:id/pattern',
  requirePerm('schedule.book'),
  validate(patternBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof patternBody>;
      const pattern = await bookPattern(centreOf(req), { ...b, patientId: String(req.params.id) }, (p, session) =>
        recordAudit(req, 'pattern.create', 'pattern', p.id, b, session),
      );
      res.status(201).json(patternDto(pattern));
    } catch (e) {
      next(e);
    }
  },
);

scheduleRouter.put(
  '/patients/:id/pattern',
  requirePerm('schedule.book'),
  validate(patternBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof patternBody>;
      const pattern = await changePattern(centreOf(req), String(req.params.id), b, (p, session) =>
        recordAudit(req, 'pattern.change', 'pattern', p.id, b, session),
      );
      res.json(patternDto(pattern));
    } catch (e) {
      next(e);
    }
  },
);

const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

scheduleRouter.get('/assignments', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const rows = await ChairAssignment.find({ centreId: centreOf(req) });
    res.json(rows.map((a) => ({ shiftId: String(a.shiftId), chairId: String(a.chairId), nurseId: String(a.nurseId) })));
  } catch (e) {
    next(e);
  }
});

const assignBody = z.object({
  shiftId: z.string().min(1),
  nurseId: z.string().min(1),
  chairIds: z.array(z.string().min(1)),
});

/** Sets the nurse's chairs for a shift (their full set), taking those chairs over from any other nurse. */
scheduleRouter.put('/assignments', requirePerm('schedule.assignNurses'), validate(assignBody), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const b = req.body as z.infer<typeof assignBody>;
    const chairIds = [...new Set(b.chairIds)];
    const shift = validId(b.shiftId) ? await Shift.findById(b.shiftId) : null;
    if (!shift || String(shift.centreId) !== centreId) throw notFound();
    const chairs = chairIds.every(validId) ? await Chair.find({ _id: { $in: chairIds }, centreId }) : [];
    if (chairs.length !== chairIds.length) throw notFound();
    const nurseRole = await Role.findOne({ key: 'nurse' });
    const nurse = validId(b.nurseId) ? await User.findById(b.nurseId) : null;
    const isNurse =
      !!nurseRole &&
      !!nurse &&
      nurse.active &&
      nurse.memberships.some((m) => String(m.centreId) === centreId && m.roleIds.some((r) => String(r) === String(nurseRole._id)));
    if (!isNurse) throw badRequest('not_a_nurse');
    await withTransaction(async (session) => {
      await ChairAssignment.deleteMany(
        { shiftId: shift._id, $or: [{ nurseId: b.nurseId }, { chairId: { $in: chairIds } }] },
        { session },
      );
      await ChairAssignment.create(
        chairIds.map((chairId) => ({ centreId, shiftId: b.shiftId, chairId, nurseId: b.nurseId })),
        { session, ordered: true },
      );
      await recordAudit(req, 'assignment.update', 'assignment', b.shiftId, b, session);
    });
    res.json({ shiftId: b.shiftId, nurseId: b.nurseId, chairIds });
  } catch (e) {
    next(e);
  }
});

const dateQuery = z.object({ date: localDate.optional() });

scheduleRouter.get('/today', requirePerm('sessions.view'), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const parsed = dateQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('validation');
    const date = parsed.data.date ?? todayLocal();
    const [sessions, assignments, chairs, shifts] = await Promise.all([
      Session.find({ centreId, date }),
      ChairAssignment.find({ centreId }),
      Chair.find({ centreId }),
      Shift.find({ centreId }),
    ]);
    const patients = await Patient.find({ _id: { $in: sessions.map((s) => s.patientId) } });
    const nurseOf = new Map(assignments.map((a) => [`${a.chairId}:${a.shiftId}`, String(a.nurseId)]));
    const chairById = new Map(chairs.map((c) => [c.id as string, c]));
    const shiftById = new Map(shifts.map((s) => [s.id as string, s]));
    const patientById = new Map(patients.map((p) => [p.id as string, p]));
    const out = { mine: [] as object[], unassigned: [] as object[], others: [] as object[] };
    for (const s of sessions) {
      const chair = chairById.get(String(s.chairId));
      const shift = shiftById.get(String(s.shiftId));
      const patient = patientById.get(String(s.patientId));
      if (!chair || !shift || !patient) continue;
      const card = {
        id: s.id as string,
        date: s.date,
        status: s.status,
        kind: s.kind,
        chair: { id: chair.id as string, label: chair.label },
        shift: { id: shift.id as string, name: shift.name, start: shift.start, end: shift.end },
        patient: { id: patient.id as string, name: patient.name },
        hasActiveOrders: false, // wired up with orders in a later task
      };
      const nurse = nurseOf.get(`${s.chairId}:${s.shiftId}`);
      (nurse === undefined ? out.unassigned : nurse === String(req.user!._id) ? out.mine : out.others).push(card);
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

const dischargeBody = z.object({ reason: z.enum(DISCHARGE_REASONS), date: localDate });

scheduleRouter.post(
  '/patients/:id/discharge',
  requirePerm('patients.discharge'),
  validate(dischargeBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof dischargeBody>;
      const patient = await loadPatientInCentre(centreOf(req), req.params.id);
      if (patient.status === 'discharged') throw conflict('already_discharged');
      await withTransaction(async (session) => {
        patient.status = 'discharged';
        patient.discharge = { reason: b.reason, date: b.date };
        await patient.save({ session });
        await endPatterns(patient.id, b.date, session);
        await recordAudit(req, 'patient.discharge', 'patient', patient.id, b, session);
      });
      res.json({ id: patient.id as string, status: patient.status, discharge: { reason: b.reason, date: b.date } });
    } catch (e) {
      next(e);
    }
  },
);
