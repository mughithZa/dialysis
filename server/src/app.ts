import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { config } from './config.js';
import { authRouter } from './auth/routes.js';
import { SESSION_COLLECTION } from './auth/revoke.js';
import { HttpError, notFound } from './lib/errors.js';
import { centresRouter } from './centres/routes.js';
import { auditRouter } from './audit/routes.js';
import { permissionsRouter, rolesRouter } from './auth/roles.routes.js';
import { usersRouter } from './users/routes.js';
import { patientsRouter } from './patients/routes.js';
import { catalogRouter } from './catalog/routes.js';
import { scheduleRouter } from './schedule/routes.js';
import { sessionsRouter } from './sessions/routes.js';
import { ordersRouter } from './orders/routes.js';
import { transfersRouter } from './transfers/routes.js';
import { meRouter } from './me/routes.js';
import { pushRouter } from './notify/routes.js';
import { centreStatsRouter, statsRouter } from './reports/routes.js';

export interface AppOptions {
  /** Directory of the built client; when set it is served with an SPA fallback. */
  clientDist?: string;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();
  if (config.isProduction) app.set('trust proxy', 1); // TLS is terminated by the reverse proxy
  app.use(express.json());
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true, // the 7-day expiry restarts on every request, so active users stay logged in
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: 1000 * 60 * 60 * 24 * 7 },
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: SESSION_COLLECTION,
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
  api.use('/auth', authRouter);
  api.use('/roles', rolesRouter);
  api.use('/permissions', permissionsRouter);
  api.use('/catalog', catalogRouter);
  api.use('/centres/:centreId/audit', auditRouter);
  api.use('/centres/:centreId/users', usersRouter);
  api.use('/centres/:centreId/patients', patientsRouter);
  api.use('/centres/:centreId', scheduleRouter);
  api.use('/centres/:centreId', sessionsRouter);
  api.use('/centres/:centreId', ordersRouter);
  api.use('/centres/:centreId', transfersRouter);
  api.use('/centres/:centreId', centreStatsRouter);
  api.use('/stats', statsRouter);
  api.use('/me', meRouter);
  api.use('/push', pushRouter);
  api.use('/centres', centresRouter);
  // Feature routers are mounted here by later tasks.
  api.use((_req, _res, next) => next(notFound()));
  app.use('/api', api);

  if (options.clientDist) {
    const dist = options.clientDist;
    const noCache = (res: express.Response) => res.setHeader('Cache-Control', 'no-cache');
    app.use(
      express.static(dist, {
        index: false,
        setHeaders(res, file) {
          const name = path.basename(file);
          if (name === 'sw.js' || name === 'index.html') noCache(res);
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // A missing asset or file (e.g. a stale hashed chunk) is a real 404: serving the HTML shell there breaks module loading.
    app.get(/^\/assets\/|\.[^/]+$/, (_req, res) => {
      res.status(404).type('text/plain').send('Not found');
    });
    // Any other GET (/api is handled above) is a client-side route.
    app.get(/.*/, (_req, res) => {
      noCache(res);
      res.sendFile('index.html', { root: dist }); // `root` so a dot-directory in the install path is not refused
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'validation' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal' });
  };
  app.use(onError);
  return app;
}
