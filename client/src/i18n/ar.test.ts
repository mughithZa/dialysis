import { describe, expect, it } from 'vitest';
import ar from './ar.json';
import en from './en.json';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const ARABIC_PLURALS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? Object.entries(flatten(v as Record<string, unknown>, `${prefix}${k}.`)) : [[`${prefix}${k}`, String(v)]],
    ),
  );
}

const EN = flatten(en);
const AR = flatten(ar);
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
/** Strings that are the same in both languages: pure placeholders and the language names themselves. */
const SAME_IN_BOTH = new Set(['language.en', 'language.ar', 'sessions.history.usage', 'sessions.history.bp', 'nurse.session.ordersBy', 'timeline.medicine']);

describe('ar.json', () => {
  it('translates every English string (plural strings in all six Arabic forms)', () => {
    const missing: string[] = [];
    for (const key of Object.keys(EN)) {
      if (PLURAL.test(key)) {
        const base = key.replace(PLURAL, '');
        for (const form of ARABIC_PLURALS) if (!(`${base}_${form}` in AR)) missing.push(`${base}_${form}`);
      } else if (!(key in AR)) missing.push(key);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('has no keys that English lacks', () => {
    const bases = new Set(Object.keys(EN).map((k) => k.replace(PLURAL, '')));
    expect(Object.keys(AR).filter((k) => !bases.has(k.replace(PLURAL, '')))).toEqual([]);
  });

  it('keeps every placeholder of the English string', () => {
    const wrong = Object.entries(AR).filter(([key, value]) => {
      const source = EN[key] ?? EN[key.replace(PLURAL, '_other')];
      // a plural form may spell the number out instead of using {{count}}
      const need = placeholders(source ?? '').filter((p) => !(PLURAL.test(key) && p === 'count'));
      return need.some((p) => !placeholders(value).includes(p));
    });
    expect(wrong.map(([k]) => k)).toEqual([]);
  });

  it('leaves nothing in English', () => {
    expect(Object.keys(AR).filter((k) => AR[k] === EN[k] && !SAME_IN_BOTH.has(k))).toEqual([]);
  });
});
