'use client';

/**
 * PixelForge Studio — service worker registration (PWA offline support).
 *
 * Mounts invisibly (renders null), registers `/sw.js` on mount and silently
 * listens for `controllerchange` — no intrusive UI. Registration is
 * production-only and skipped on localhost.
 *
 * After a successful registration the component dispatches a global
 * `pf:offline-ready` event so other UI (status bar, settings dialog) can
 * surface offline availability without this component owning any visuals.
 */

import { useEffect } from 'react';

function isLocalHost(): boolean {
  return (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]' ||
    location.hostname.endsWith('.localhost')
  );
}

export default function PwaRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (isLocalHost()) return;

    let cancelled = false;

    const register = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;
        // The SW now controls (or will control) the app shell — offline works.
        window.dispatchEvent(new Event('pf:offline-ready'));
        // Watch for a replaced worker taking control (silent update path).
        if (registration.waiting) {
          registration.waiting.addEventListener('statechange', () => {
            if (registration.waiting?.state === 'activated') {
              window.dispatchEvent(new Event('pf:offline-ready'));
            }
          });
        }
      } catch {
        // Registration is best-effort; the editor is fully usable without it.
      }
    };

    const onControllerChange = (): void => {
      // A new worker took control (first activation or update) — stay silent.
      window.dispatchEvent(new Event('pf:offline-ready'));
    };

    void register();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
