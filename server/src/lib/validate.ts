import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validate(schema: ZodType, part: 'body' | 'query' = 'body'): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[part]);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation', issues: parsed.error.issues });
      return;
    }
    if (part === 'body') {
      req.body = parsed.data;
    } else {
      // Express 5: req.query is a getter; shadow it with the parsed value.
      Object.defineProperty(req, 'query', { value: parsed.data, writable: true, configurable: true });
    }
    next();
  };
}
