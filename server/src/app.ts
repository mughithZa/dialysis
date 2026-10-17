import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { config } from './config.js';
import { HttpError, notFound } from './lib/errors.js';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        // interval cleanup avoids an unawaited TTL-index creation racing with client close
        autoRemove: 'interval',
        autoRemoveInterval: 10,
      }),
    }),
  );

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  // Feature routers are mounted here by later tasks.
  api.use((_req, _res, next) => next(notFound()));
  app.use('/api', api);

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal' });
  };
  app.use(onError);
  return app;
}
