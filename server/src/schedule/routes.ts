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
import { Session, type SessionDoc } from '../sessions/session.model.js';
import { toSessionCards } from '../sessions/card.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { bookPlan, changePlan, endPlans, type BookResult } from './booking.js';
import { Plan, type PlanDoc } from './plan.model.js';
import { freeMachines } from './slots.js';
import { buildBoard } from './board.js';

export const scheduleRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid);

// ---------- plans and bookings ----------

const planItems = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), shiftId: z.string().min(1), chairId: z.string().min(1) }))
  .min(1)
  .max(7)
  .refine((items) => new Set(items.map((i) => `${i.weekday}:${i.shiftId}`)).size === items.length);

const bookBody = z.object({
  items: planItems,
  from: localDate,
  repeat: z.enum(['once', 'weekly']),
  to: localDate.nullable().optional(),
});
const changeBody = z.object({ items: planItems, from: localDate, to: localDate.nullable().optional() });

const planDto = (p: PlanDoc) => ({
  id: p.id as string,
  patientId: String(p.patientId),
  items: p.items.map((i) => ({ weekday: i.weekday, shiftId: String(i.shiftId), chairId: String(i.chairId) })),
  from: p.from,
  to: p.to ?? null,
  repeat: p.repeat,
});

const bookedSessionDto = (s: SessionDoc) => ({
  id: s.id as string,
  date: s.date,
  shiftId: String(s.shiftId),
  chairId: String(s.chairId),
  shiftStart: s.shiftStart,
  shiftEnd: s.shiftEnd,
  chairLabel: s.chairLabel,
  kind: s.kind,
  status: s.status,
});

const bookResultDto = (r: BookResult) =>
  'plan' in r ? { plan: planDto(r.plan) } : { sessions: r.sessions.map(bookedSessionDto) };

/** Audits a booking: a weekly plan as `plan.create` on the plan, a one-off as `booking.once` on the patient. */
const auditBooking = (req: Request, body: object) => (r: BookResult, session: mongoose.ClientSession) =>
  'plan' in r
    ? recordAudit(req, 'plan.create', 'plan', r.plan.id as string, body, session)
    : recordAudit(req, 'booking.once', 'patient', String(req.params.id), body, session);

scheduleRouter.post('/patients/:id/plan', requirePerm('schedule.book'), validate(bookBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof bookBody>;
    const result = await bookPlan(centreOf(req), String(req.params.id), b, auditBooking(req, b));
    res.status(201).json(bookResultDto(result));
  } catch (e) {
    next(e);
  }
});

scheduleRouter.put('/patients/:id/plan', requirePerm('schedule.book'), validate(changeBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof changeBody>;
    const plan = await changePlan(centreOf(req), String(req.params.id), b, (p, session) =>
      recordAudit(req, 'plan.change', 'plan', p.id as string, b, session),
    );
    res.json({ plan: planDto(plan) });
  } catch (e) {
    next(e);
  }
});

/**
 * Of a patient's plans still holding (`to` empty or ≥ today), the one in force today (`from ≤ today`), else the
 * next one to start.
 */
function planNow<T extends { from: string }>(plans: T[], today: string): T | undefined {
  const inForce = plans.filter((p) => p.from <= today).sort((a, b) => b.from.localeCompare(a.from));
  return inForce[0] ?? [...plans].sort((a, b) => a.from.localeCompare(b.from))[0];
}

/** The patient's plan in force today, else the next one to start, or null. */
scheduleRouter.get('/patients/:id/plan', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const today = todayLocal();
    const plans = await Plan.find({ patientId: patient._id, $or: [{ to: null }, { to: { $gte: today } }] });
    const plan = planNow(plans, today);
    res.json({ plan: plan ? planDto(plan) : null });
  } catch (e) {
    next(e);
  }
});

const freeQuery = z.object({ date: localDate, shiftId: z.string().min(1), patientId: z.string().min(1).optional() });

/** Machines free in a block on a date; with `patientId`, that patient's own holdings count as free. */
scheduleRouter.get('/schedule/free', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const parsed = freeQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('validation');
    const { date, shiftId, patientId } = parsed.data;
    const patient = patientId === undefined ? null : await loadPatientInCentre(centreId, patientId);
    res.json(await freeMachines(centreId, shiftId, date, patient ? { ignorePatientId: patient._id } : {}));
  } catch (e) {
    next(e);
  }
});

// ---------- legacy grid and pattern endpoints (the current client) until the calendar replaces them ----------

/**
 * The weekly grid: each (machine, block, weekday) held by a current plan, with its patient. One plan per patient:
 * the one in force today, else the next one to start (`planNow`).
 */
scheduleRouter.get('/schedule/grid', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const today = todayLocal();
    const [chairs, shifts, plans] = await Promise.all([
      Chair.find({ centreId }).sort({ label: 1 }),
      Shift.find({ centreId }).sort({ start: 1 }),
      Plan.find({ centreId, $or: [{ to: null }, { to: { $gte: today } }] }).lean(),
    ]);
    const byPatient = new Map<string, (typeof plans)[number][]>();
    for (const p of plans) byPatient.set(String(p.patientId), [...(byPatient.get(String(p.patientId)) ?? []), p]);
    const planOf = new Map([...byPatient].map(([id, ps]) => [id, planNow(ps, today)!]));
    const patients = await Patient.find({ _id: { $in: [...planOf.keys()] } });
    const nameOf = new Map(patients.map((p) => [p.id as string, p.name]));
    res.json({
      chairs: chairs.map((c) => ({ id: c.id as string, label: c.label, active: c.active })),
      shifts: shifts.map((s) => ({ id: s.id as string, name: s.name, start: s.start, end: s.end, active: s.active })),
      slots: [...planOf.values()].flatMap((p) => {
        const id = String(p.patientId);
        const name = nameOf.get(id);
        if (name === undefined) return [];
        return p.items.map((i) => ({
          chairId: String(i.chairId),
          shiftId: String(i.shiftId),
          weekday: i.weekday,
          patient: { id, name },
        }));
      }),
    });
  } catch (e) {
    next(e);
  }
});

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
const patternItems = (b: z.infer<typeof patternBody>) =>
  b.weekdays.map((weekday) => ({ weekday, shiftId: b.shiftId, chairId: b.chairId }));
const patternDto = (p: PlanDoc) => ({
  id: p.id as string,
  patientId: String(p.patientId),
  chairId: String(p.items[0]!.chairId),
  shiftId: String(p.items[0]!.shiftId),
  weekdays: p.items.map((i) => i.weekday),
  from: p.from,
  to: p.to ?? null,
});

/** Old "book a pattern" (one machine and block on 1–3 weekdays): a weekly plan with one item per weekday. */
scheduleRouter.post('/patients/:id/pattern', requirePerm('schedule.book'), validate(patternBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof patternBody>;
    const result = await bookPlan(
      centreOf(req),
      String(req.params.id),
      { items: patternItems(b), from: b.from, repeat: 'weekly' },
      auditBooking(req, b),
    );
    if (!('plan' in result)) throw new Error('weekly booking returned no plan');
    res.status(201).json(patternDto(result.plan));
  } catch (e) {
    next(e);
  }
});

scheduleRouter.put('/patients/:id/pattern', requirePerm('schedule.book'), validate(patternBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof patternBody>;
    const plan = await changePlan(centreOf(req), String(req.params.id), { items: patternItems(b), from: b.from }, (p, session) =>
      recordAudit(req, 'plan.change', 'plan', p.id as string, b, session),
    );
    res.json(patternDto(plan));
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
    const sessions = await Session.find({ centreId, date });
    const out = { mine: [] as object[], unassigned: [] as object[], others: [] as object[] };
    for (const { card, nurseId } of await toSessionCards(centreId, sessions)) {
      (nurseId === undefined ? out.unassigned : nurseId === String(req.user!._id) ? out.mine : out.others).push(card);
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

const boardQuery = z.object({ date: localDate.optional(), shiftId: z.string().min(1).optional() });

scheduleRouter.get('/board', requirePerm('sessions.view'), async (req, res, next) => {
  try {
    const parsed = boardQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('validation');
    res.json(await buildBoard(centreOf(req), String(req.user!._id), parsed.data));
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
      if (patient.status === 'transferring') throw conflict('transfer_pending');
      if (patient.status === 'discharged') throw conflict('already_discharged');
      await withTransaction(async (session) => {
        patient.status = 'discharged';
        patient.discharge = { reason: b.reason, date: b.date };
        await patient.save({ session });
        await endPlans(patient.id, b.date, session);
        await recordAudit(req, 'patient.discharge', 'patient', patient.id, b, session);
      });
      res.json({ id: patient.id as string, status: patient.status, discharge: { reason: b.reason, date: b.date } });
    } catch (e) {
      next(e);
    }
  },
);
