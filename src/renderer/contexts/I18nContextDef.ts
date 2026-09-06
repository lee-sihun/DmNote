import { createContext } from 'react';

export type SupportedLocale = 'ko' | 'en' | 'zh-cn' | 'zh-Hant' | 'ru';

export interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
