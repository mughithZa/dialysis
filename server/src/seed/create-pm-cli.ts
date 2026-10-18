import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { createProgramManager, pmFromEnv } from './create-pm.js';

try {
  const pm = pmFromEnv(process.env);
  await connectDb(config.mongoUrl);
  await createProgramManager(pm);
  console.log(`program manager "${pm.username}" created`);
} catch (e) {
  console.error(`create-pm: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
