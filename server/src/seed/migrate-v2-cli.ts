import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { migrateV2 } from './migrate-v2.js';

try {
  await connectDb(config.mongoUrl);
  const { skipped, ...counts } = await migrateV2();
  console.log(`migrate:v2 done: ${JSON.stringify(counts)}`);
  if (skipped.length) {
    console.log(`${skipped.length} record(s) skipped:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
} catch (e) {
  console.error(`migrate:v2: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
