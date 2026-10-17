import mongoose, { type ClientSession } from 'mongoose';
import { config } from './config.js';

export async function connectDb(url: string = config.mongoUrl): Promise<typeof mongoose> {
  return mongoose.connect(url);
}

/** Runs `fn` inside a Mongo transaction (requires a replica set); retries transient errors. */
export async function withTransaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
