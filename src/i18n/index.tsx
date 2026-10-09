'use client';

/**
 * i18n provider + hook. Reads/writes the language from the editor store so
 * the preference persists with settings.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import { translate, type TranslationKey } from './dictionaries';

interface I18nContextValue {
  lang: 'en' | 'id';
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useEditorStore((s) => s.settings.language);
  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // non-React fallback (engine code, workers)
    return { lang: 'en', t: (key, vars) => translate('en', key, vars) };
  }
  return ctx;
}
