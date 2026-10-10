'use client';

/**
 * useViewportTier / useOrientation / useStandalone — responsive layout contract.
 *
 * The editor ships three layout tiers so PC, tablets (iPad / Android) and
 * phones all get a purpose-built shell instead of a binary desktop/mobile
 * split:
 *
 *   - 'desktop' ≥ 1024px  → DesktopWorkspace (full panel chrome)
 *   - 'tablet'  640–1023  → MobileWorkspace with tablet adaptations
 *                           (side drawer panels, roomier dock)
 *   - 'phone'   < 640     → MobileWorkspace compact shell
 *
 * All hooks are matchMedia-driven so they react to rotation, window resize
 * and iPadOS/Android split-screen changes without layout thrash (the media
 * queries are evaluated by the browser, not in JS on every event).
 */

import { useEffect, useState } from 'react';

export type ViewportTier = 'desktop' | 'tablet' | 'phone';
export type ScreenOrientation = 'landscape' | 'portrait';

const DESKTOP_QUERY = '(min-width: 1024px)';
const PHONE_MAX_QUERY = '(max-width: 639.98px)';
const LANDSCAPE_QUERY = '(orientation: landscape)';
const STANDALONE_QUERY = '(display-mode: standalone)';

/** 'desktop' ≥1024px · 'tablet' 640–1023px · 'phone' <640px (SSR-safe: phone). */
export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() => {
    if (typeof window === 'undefined') return 'phone';
    if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
    if (window.matchMedia(PHONE_MAX_QUERY).matches) return 'phone';
    return 'tablet';
  });

  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const phoneMax = window.matchMedia(PHONE_MAX_QUERY);
    const recompute = (): void => {
      if (desktop.matches) setTier('desktop');
      else if (phoneMax.matches) setTier('phone');
      else setTier('tablet');
    };
    desktop.addEventListener('change', recompute);
    phoneMax.addEventListener('change', recompute);
    return () => {
      desktop.removeEventListener('change', recompute);
      phoneMax.removeEventListener('change', recompute);
    };
  }, []);

  return tier;
}

/** Viewport orientation via the CSS media query (updates on rotation). */
export function useOrientation(): ScreenOrientation {
  const [orientation, setOrientation] = useState<ScreenOrientation>(() => {
    if (typeof window === 'undefined') return 'landscape';
    return window.matchMedia(LANDSCAPE_QUERY).matches ? 'landscape' : 'portrait';
  });

  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const onChange = (): void => setOrientation(mql.matches ? 'landscape' : 'portrait');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return orientation;
}

/**
 * True when the app runs installed (PWA standalone on iOS/Android/desktop).
 * Used to fine-tune safe-area chrome — installed apps always render under
 * the OS status bar, browser tabs usually not.
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia(STANDALONE_QUERY).matches) return true;
    // iOS Safari reports standalone via navigator, not matchMedia.
    return 'standalone' in window.navigator && Boolean((window.navigator as { standalone?: boolean }).standalone);
  });

  useEffect(() => {
    const mql = window.matchMedia(STANDALONE_QUERY);
    const onChange = (): void => setStandalone(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return standalone;
}

export { DESKTOP_QUERY, PHONE_MAX_QUERY, LANDSCAPE_QUERY, STANDALONE_QUERY };
