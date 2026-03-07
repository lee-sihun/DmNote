import { useContext } from 'react';
import { I18nContext } from './I18nContextDef';

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within I18nProvider');
  }

  return {
    t: ctx.t,
    i18n: {
      language: ctx.locale,
      changeLanguage: ctx.setLocale,
    },
  };
}
