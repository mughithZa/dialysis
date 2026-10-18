import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(root, 'server');
const tsx = resolve(root, 'node_modules/.bin/tsx');

export interface E2eState {
  replSet: MongoMemoryReplSet;
  server: ChildProcess;
}
// Shared with global-teardown (both run in the same process).
export const state: Partial<E2eState> = ((globalThis as { __e2e?: Partial<E2eState> }).__e2e ??= {});

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolvePort(port));
    });
  });
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((done, fail) => {
    const p = spawn(tsx, args, { cwd: serverDir, env, stdio: 'inherit' });
    p.once('exit', (code) => (code === 0 ? done() : fail(new Error(`${args.join(' ')} exited with ${code}`))));
  });
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server did not become healthy in time');
    await new Promise((r) => setTimeout(r, 250));
  }
}

export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  state.replSet = replSet;
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    MONGO_URL: replSet.getUri('dialysis-e2e'),
    SESSION_SECRET: 'e2e-session-secret',
    APP_TZ: 'Asia/Damascus',
  };
  await run(['src/seed/e2e.ts'], env);
  state.server = spawn(tsx, ['src/index.ts'], { cwd: serverDir, env, stdio: 'inherit' });
  // `localhost` (not 127.0.0.1): browsers only accept Secure cookies over plain http there.
  const baseUrl = `http://localhost:${port}`;
  await waitForHealth(baseUrl);
  process.env.E2E_BASE_URL = baseUrl;
}
