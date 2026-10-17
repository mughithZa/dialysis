import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { DISCHARGE_REASONS } from '../patients/patient.model.js';
import { loadPatientInCentre } from '../patients/load.js';
import { validate } from '../lib/validate.js';
import { conflict } from '../lib/errors.js';
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
