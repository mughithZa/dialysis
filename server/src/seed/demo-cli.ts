import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { assertSeedAllowed, seedDemo } from './demo.js';

assertSeedAllowed(process.env);
await connectDb(config.mongoUrl);
try {
  const { created } = await seedDemo();
  console.log(created ? 'demo data seeded (all passwords: demo1234)' : 'already seeded');
} finally {
  await mongoose.disconnect();
}
