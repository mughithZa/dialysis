import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from './en.json';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('en.json', () => {
  it('has every literal key passed to t()', () => {
    const keys = new Set(flatten(en).map((k) => k.replace(PLURAL, '')));
    const missing = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)]
        .map((m) => m[1]!)
        .filter((k) => !keys.has(k))
        .map((k) => `${k} (${path.relative(SRC, file)})`),
    );
    expect(missing).toEqual([]);
  });
});
