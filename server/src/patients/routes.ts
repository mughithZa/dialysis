import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { conflict } from '../lib/errors.js';
import { loadPatientInCentre } from './load.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { User } from '../auth/user.model.js';
import { hashPassword } from '../auth/password.js';
import { Patient, PATIENT_STATUSES, type PatientDoc } from './patient.model.js';

export const patientsRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export { loadPatientInCentre };

const patientDto = (p: PatientDoc) => ({
  id: p.id as string,
  userId: String(p.userId),
  name: p.name,
  phone: p.phone ?? null,
  emergencyContact: {
    name: p.emergencyContact?.name ?? null,
    phone: p.emergencyContact?.phone ?? null,
    relation: p.emergencyContact?.relation ?? null,
  },
  kidneyFailureCause: p.kidneyFailureCause ?? null,
  address: p.address ?? null,
  socialSituation: p.socialSituation ?? null,
  financialSituation: p.financialSituation ?? null,
  otherDiseases: p.otherDiseases ?? null,
  notes: p.notes ?? null,
  status: p.status,
  discharge: p.discharge ? { reason: p.discharge.reason, date: p.discharge.date } : null,
  createdAt: p.createdAt,
});

const text = z.string().trim().min(1).optional();
const fields = {
  name: z.string().trim().min(1),
  phone: text,
  emergencyContact: z.object({ name: text, phone: text, relation: text }).optional(),
  kidneyFailureCause: text,
  address: text,
  socialSituation: text,
  financialSituation: text,
  otherDiseases: text,
  notes: text,
};

const createBody = z.object({
  ...fields,
  login: z.object({ username: z.string().trim().min(1), password: z.string().min(8) }),
});

patientsRouter.post('/', requirePerm('patients.create'), validate(createBody), async (req, res, next) => {
  try {
    const { login, ...b } = req.body as z.infer<typeof createBody>;
    const passwordHash = await hashPassword(login.password);
    let created: PatientDoc;
    try {
      created = await withTransaction(async (session) => {
        const [user] = await User.create(
          [{ username: login.username, passwordHash, name: b.name, phone: b.phone, kind: 'patient' }],
          { session },
        );
        const [patient] = await Patient.create([{ ...b, centreId: centreOf(req), userId: user!._id }], { session });
        await recordAudit(req, 'patient.create', 'patient', patient!.id, { name: b.name, username: login.username }, session);
        return patient!;
      });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('username_taken');
      throw e;
    }
    res.status(201).json(patientDto(created));
  } catch (e) {
    next(e);
  }
});

const listQuery = z.object({
  q: z.string().trim().min(1).optional(),
  status: z.enum(PATIENT_STATUSES).default('active'),
});

patientsRouter.get('/', requirePerm('patients.view'), validate(listQuery, 'query'), async (req, res, next) => {
  try {
    const { q, status } = req.query as unknown as z.infer<typeof listQuery>;
    const filter: mongoose.FilterQuery<PatientDoc> = { centreId: centreOf(req), status };
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { phone: rx }];
    }
    res.json((await Patient.find(filter).sort({ name: 1 })).map(patientDto));
  } catch (e) {
    next(e);
  }
});

patientsRouter.get('/:id', requirePerm('patients.view'), async (req, res, next) => {
  try {
    res.json(patientDto(await loadPatientInCentre(centreOf(req), req.params.id)));
  } catch (e) {
    next(e);
  }
});

const patchBody = z.object({ ...fields, name: fields.name.optional() }).strict();

patientsRouter.patch('/:id', requirePerm('patients.edit'), validate(patchBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof patchBody>;
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const { emergencyContact, ...rest } = b;
    patient.set(rest);
    if (emergencyContact) {
      for (const [k, v] of Object.entries(emergencyContact)) patient.set(`emergencyContact.${k}`, v);
    }
    await withTransaction(async (session) => {
      await patient.save({ session });
      if (b.name !== undefined || b.phone !== undefined) {
        await User.updateOne(
          { _id: patient.userId },
          { $set: { ...(b.name !== undefined && { name: b.name }), ...(b.phone !== undefined && { phone: b.phone }) } },
          { session },
        );
      }
      await recordAudit(req, 'patient.update', 'patient', patient.id, b, session);
    });
    res.json(patientDto(patient));
  } catch (e) {
    next(e);
  }
});
