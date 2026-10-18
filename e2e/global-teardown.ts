import { state } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  const { server, replSet } = state;
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await exited;
  }
  await replSet?.stop();
}
