import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { validate } from '../lib/validate.js';
import { vapidConfigured } from './push.js';
import { config } from '../config.js';
import { PushSubscription } from './subscription.model.js';

export const pushRouter = Router();
pushRouter.use(requireAuth);

const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'https required');
const subscribeBody = z.object({
  endpoint: httpsUrl,
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().min(1) });

pushRouter.get('/key', (_req, res) => {
  res.json({ publicKey: vapidConfigured() ? config.vapidPublic : null });
});

pushRouter.post('/subscribe', validate(subscribeBody), async (req, res) => {
  const { endpoint, keys } = req.body as z.infer<typeof subscribeBody>;
  await PushSubscription.findOneAndUpdate({ endpoint }, { $set: { userId: req.session.userId, keys } }, { upsert: true });
  res.status(204).end();
});

pushRouter.post('/unsubscribe', validate(unsubscribeBody), async (req, res) => {
  const { endpoint } = req.body as z.infer<typeof unsubscribeBody>;
  await PushSubscription.deleteOne({ endpoint, userId: req.session.userId });
  res.status(204).end();
});
