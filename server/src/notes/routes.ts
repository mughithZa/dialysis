import { Router, type Request } from 'express';
import { z } from 'zod';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { withTransaction } from '../db.js';
import { validate } from '../lib/validate.js';
import { loadPatientInCentre } from '../patients/load.js';
import { PatientNote } from './patient-note.model.js';
import { toNoteItems } from './service.js';

export const notesRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const createBody = z.object({ text: z.string().trim().min(1).max(2000) });

notesRouter.get('/patients/:id/notes', requirePerm('orders.view'), async (req, res, next) => {
  try {
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    res.json(await toNoteItems(await PatientNote.find({ patientId: patient._id }).sort({ at: -1, _id: -1 })));
  } catch (e) {
    next(e);
  }
});

notesRouter.post('/patients/:id/notes', requirePerm('orders.write'), validate(createBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof createBody>;
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const note = await withTransaction(async (tx) => {
      const [n] = await PatientNote.create(
        [{ patientId: patient._id, centreId: centreOf(req), authorId: req.user!._id, text: b.text, at: new Date() }],
        { session: tx },
      );
      await recordAudit(req, 'patient_note.create', 'patient_note', n!.id, { patientId: patient.id }, tx);
      return n!;
    });
    res.status(201).json((await toNoteItems([note]))[0]);
  } catch (e) {
    next(e);
  }
});
