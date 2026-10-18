export interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

let deferred: InstallEvent | null = null;
let registered = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/**
 * Call once at app start (main.tsx). Chrome fires `beforeinstallprompt` once, shortly after load,
 * possibly before any screen mounts, so the event is kept here for InstallPrompt to read later.
 */
export function captureInstallPrompt() {
  if (registered) return;
  registered = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => clearInstallPrompt());
}

export const getInstallPrompt = () => deferred;

export function clearInstallPrompt() {
  deferred = null;
  emit();
}

export function subscribeInstallPrompt(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
