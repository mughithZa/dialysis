import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';

describe('app', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it('unknown api route → 404 json', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});

describe('serving the built client', () => {
  const dirs: string[] = [];
  const makeDist = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html><body>app shell</body></html>');
    writeFileSync(join(dir, 'sw.js'), '// service worker');
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    return dir;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('serves index.html at / and for unknown client routes (SPA fallback), never cached', async () => {
    const app = createApp({ clientDist: makeDist() });
    for (const path of ['/', '/c/123/patients']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('app shell');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves the shell when the install path contains a dot-directory (e.g. a .claude worktree)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'dot-'));
    dirs.push(parent);
    const dist = join(parent, '.hidden', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<html><body>app shell</body></html>');
    const res = await request(createApp({ clientDist: dist })).get('/c/1/patients');
    expect(res.status).toBe(200);
    expect(res.text).toContain('app shell');
  });

  it('does not cache sw.js and caches hashed assets long-term', async () => {
    const app = createApp({ clientDist: makeDist() });
    const sw = await request(app).get('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toMatch(/max-age=31536000.*immutable/);
  });

  it('missing assets and file-like paths are a plain 404, not the SPA shell', async () => {
    const app = createApp({ clientDist: makeDist() });
    for (const path of ['/assets/index-old999.js', '/assets/nested/thing', '/favicon.ico', '/c/1/logo.png']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.text).not.toContain('app shell');
    }
  });

  it('keeps /api/* unknown routes as JSON 404, not the SPA shell', async () => {
    const app = createApp({ clientDist: makeDist() });
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('serves no client when no dist is configured', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(404);
  });
});

describe('production config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses to boot in production without SESSION_SECRET', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', '');
    vi.resetModules();
    await expect(import('./config.js')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('boots in production with a SESSION_SECRET', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'a-real-secret');
    vi.resetModules();
    const { config } = await import('./config.js');
    expect(config.isProduction).toBe(true);
    expect(config.sessionSecret).toBe('a-real-secret');
  });
});
