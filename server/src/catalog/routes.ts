import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { recordAudit } from '../audit/record.js';
import { requirePermAnywhere } from '../auth/middleware.js';
import { hasPermAnywhere } from '../auth/effective.js';
import { mergeItems } from './merge.js';
import { Unit, type UnitDoc } from './unit.model.js';
import { ITEM_STATUSES, ITEM_TYPES, Item, type ItemDoc } from './item.model.js';

export const catalogRouter = Router();

const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oid = z.string().refine((s) => mongoose.isValidObjectId(s));

const unitDto = (u: UnitDoc) => ({ id: u.id as string, name: u.name });
const itemDto = (i: ItemDoc) => ({
  id: i.id as string,
  name: i.name,
  type: i.type,
  unitId: String(i.unitId),
  status: i.status,
  mergedInto: i.mergedInto ? String(i.mergedInto) : null,
  used: i.used,
});

catalogRouter.get('/units', requirePermAnywhere('catalog.view', 'catalog.add', 'catalog.manage'), async (_req, res, next) => {
  try {
    const units = await Unit.find().sort({ nameKey: 1 });
    res.json(units.map(unitDto));
  } catch (e) {
    next(e);
  }
});

const unitBody = z.object({ name: z.string().trim().min(1) });
catalogRouter.post('/units', requirePermAnywhere('catalog.add', 'catalog.manage'), validate(unitBody), async (req, res, next) => {
  try {
    const { name } = req.body as z.infer<typeof unitBody>;
    const nameKey = name.toLowerCase();
    const existing = await Unit.findOne({ nameKey });
    if (existing) {
      res.status(200).json(unitDto(existing));
      return;
    }
    let unit: UnitDoc;
    try {
      unit = await Unit.create({ name });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      // Lost a creation race: return the winner.
      res.status(200).json(unitDto((await Unit.findOne({ nameKey }))!));
      return;
    }
    await recordAudit(req, 'unit.create', 'unit', unit.id, { name });
    res.status(201).json(unitDto(unit));
  } catch (e) {
    next(e);
  }
});

const listQuery = z.object({
  type: z.enum(ITEM_TYPES).optional(),
  q: z.string().trim().optional(),
  status: z.enum(ITEM_STATUSES).optional(),
});
catalogRouter.get('/items', requirePermAnywhere('catalog.view', 'catalog.manage'), validate(listQuery, 'query'), async (req, res, next) => {
  try {
    const { type, q, status } = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = { status: status ?? { $ne: 'retired' } };
    if (type) filter.type = type;
    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
    const items = await Item.find(filter).sort({ nameKey: 1 });
    res.json(items.map(itemDto));
  } catch (e) {
    next(e);
  }
});

const createBody = z.object({ name: z.string().trim().min(1), type: z.enum(ITEM_TYPES), unitId: oid });
catalogRouter.post('/items', requirePermAnywhere('catalog.add', 'catalog.manage'), validate(createBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof createBody>;
    if (!(await Unit.exists({ _id: b.unitId }))) throw badRequest('unit_not_found');
    const manager = await hasPermAnywhere(req.user!, 'catalog.manage');
    let item: ItemDoc;
    try {
      item = await Item.create({ ...b, status: manager ? 'approved' : 'pending', createdBy: req.user!._id });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('item_exists');
      throw e;
    }
    await recordAudit(req, 'item.create', 'item', item.id, { name: item.name, type: item.type, status: item.status });
    res.status(201).json(itemDto(item));
  } catch (e) {
    next(e);
  }
});

const patchBody = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(ITEM_TYPES).optional(),
  unitId: oid.optional(),
  status: z.enum(ITEM_STATUSES).optional(),
});
catalogRouter.patch('/items/:id', requirePermAnywhere('catalog.manage'), validate(patchBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof patchBody>;
    const id = String(req.params.id);
    const item = mongoose.isValidObjectId(id) ? await Item.findById(id) : null;
    if (!item) throw notFound();
    if (b.unitId !== undefined && b.unitId !== String(item.unitId)) {
      if (item.used) throw conflict('unit_locked');
      if (!(await Unit.exists({ _id: b.unitId }))) throw badRequest('unit_not_found');
    }
    if (b.name !== undefined) item.name = b.name;
    if (b.type !== undefined) item.type = b.type;
    if (b.unitId !== undefined) item.unitId = new mongoose.Types.ObjectId(b.unitId);
    if (b.status !== undefined) item.status = b.status;
    try {
      await item.save();
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('item_exists');
      throw e;
    }
    await recordAudit(req, 'item.update', 'item', item.id, b);
    res.json(itemDto(item));
  } catch (e) {
    next(e);
  }
});

const mergeBody = z.object({ intoId: oid });
catalogRouter.post('/items/:id/merge', requirePermAnywhere('catalog.manage'), validate(mergeBody), async (req, res, next) => {
  try {
    const { intoId } = req.body as z.infer<typeof mergeBody>;
    const fromId = String(req.params.id);
    if (!mongoose.isValidObjectId(fromId)) throw notFound();
    const { from, into } = await mergeItems(fromId, intoId);
    await recordAudit(req, 'item.merge', 'item', from.id, { intoId });
    res.json({ from: itemDto(from), into: itemDto(into) });
  } catch (e) {
    next(e);
  }
});
