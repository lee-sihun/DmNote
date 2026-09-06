import { fetchLocale, getI18nListeners } from '../shared';

export const i18nApi = {
  getLocale: async () => {
    return fetchLocale();
  },
  onLocaleChange: (listener: (locale: string) => void) => {
    const listeners = getI18nListeners();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
