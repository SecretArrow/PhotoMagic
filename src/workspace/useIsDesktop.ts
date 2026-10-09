'use client';

import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** True when the viewport is at least 1024px wide (desktop workspace). */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
