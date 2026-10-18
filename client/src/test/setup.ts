import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';
import '../i18n';

// Node's fetch needs absolute URLs; the app calls relative `/api/...` paths.
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) =>
  nativeFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin) : input, init);

// Mantine needs these browser APIs, which jsdom lacks.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.HTMLElement.prototype.scrollIntoView ??= () => {};


beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterAll(() => server.close());
