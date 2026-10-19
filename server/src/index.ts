import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { startJobs } from './notify/jobs.js';
import { seedRoles } from './auth/roles.seed.js';
import { syncSessionIndexes } from './sessions/session.model.js';

// Production serves the built client (client/dist) itself; in development Vite does.
const clientDist = config.isProduction ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist') : undefined;

await connectDb();
// swaps the legacy all-status patient/date/block index for the live-only one; on failure the legacy index stays (safe, stricter)
await syncSessionIndexes().catch((e: unknown) => console.error('session index sync failed', e));
await seedRoles(); // inserts only missing default roles, so a fresh database is usable
startJobs();
createApp({ clientDist }).listen(config.port, () => {
  console.log(`server listening on :${config.port}`);
});
