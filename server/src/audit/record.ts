import type { Request } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { AuditEntry } from './audit.model.js';

/** Records an audit entry for the authenticated user; centre comes from the route's :centreId when present. */
export async function recordAudit(
  req: Request,
  action: string,
  entity: string,
  entityId: string,
  details?: object,
  session?: ClientSession,
): Promise<void> {
  if (!req.user) throw new Error('recordAudit requires an authenticated request');
  const raw = req.params.centreId;
  const centreId = typeof raw === 'string' && mongoose.isValidObjectId(raw) ? raw : null;
  await AuditEntry.create([{ userId: req.user._id, centreId, action, entity, entityId, details }], { session });
}
