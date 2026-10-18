import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { migrateV2, migrationMarker } from './migrate-v2.js';

try {
  await connectDb(config.mongoUrl);
  const before = await migrationMarker();
  if (before) {
    console.log(`already migrated on ${before.at.toISOString()}; ${before.skipped.length} records were skipped${before.skipped.length ? ':' : '.'}`);
    for (const s of before.skipped) console.log(`  - ${s}`);
  } else {
    const { skipped, ...counts } = await migrateV2();
    console.log(`migrate:v2 done: ${JSON.stringify(counts)}`);
    if (skipped.length) console.log(`${skipped.length} records skipped:`);
    for (const s of skipped) console.log(`  - ${s}`);
    if (!(await migrationMarker())) {
      console.log('migrate:v2 NOT finished: resolve the records above, then run it again.');
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error(`migrate:v2: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
