import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SettingsDiff, SettingsState } from '@src/types/settings/settings';
import { I18nContext } from './I18nContextDef';
import type { SupportedLocale, I18nContextValue } from './I18nContextDef';
import { settingsApi } from '@api/modules/settingsApi';

export type { SupportedLocale } from './I18nContextDef';

type Messages = Record<string, unknown>;

const STORAGE_KEY = 'dmnote:locale';
const LOCALE_INIT_KEY = 'dmnote:locale_initialized';
const DEFAULT_LOCALE: SupportedLocale = 'ko';

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    value === 'ko' ||
    value === 'en' ||
    value === 'zh-cn' ||
    value === 'zh-Hant' ||
    value === 'ru'
  );
}

function safeLocalStorageGet(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn('Failed to read localStorage', error);
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn('Failed to persist localStorage', error);
  }
}

function getNestedValue(messages: Messages, path: string) {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
) {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const candidates: string[] = [];
  try {
    if (Array.isArray(navigator.languages)) {
      candidates.push(...navigator.languages);
    }
    if (navigator.language) {
      candidates.push(navigator.language);
    }
  } catch {
    // ignore
  }

  const normalized = candidates
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  const isKorean = normalized.some(
    (value) => value === 'ko' || value.startsWith('ko-'),
  );
  if (isKorean) return 'ko';

  const isSimplifiedChinese = normalized.some(
    (value) =>
      value === 'zh-cn' ||
      value === 'zh-hans' ||
      value.startsWith('zh-cn') ||
      value.startsWith('zh-hans'),
  );
  if (isSimplifiedChinese) return 'zh-cn';

  const isTraditionalChinese = normalized.some(
    (value) =>
      value === 'zh-tw' ||
      value === 'zh-hk' ||
      value === 'zh-hant' ||
      value.startsWith('zh-tw') ||
      value.startsWith('zh-hk') ||
      value.startsWith('zh-hant'),
  );
  if (isTraditionalChinese) return 'zh-Hant';

  const isRussian = normalized.some(
    (value) => value === 'ru' || value.startsWith('ru-'),
  );
  if (isRussian) return 'ru';

  return 'en';
}

function loadInitialLocale(): SupportedLocale {
  const stored = safeLocalStorageGet(STORAGE_KEY);
  if (isSupportedLocale(stored)) return stored;
  return detectBrowserLocale();
}

async function importLocaleMessages(locale: SupportedLocale) {
  const mod = await import(`../locales/${locale}.json`);
  return mod.default ?? mod;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() =>
    loadInitialLocale(),
  );
  const [messages, setMessages] = useState<Messages>({});
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const loadedMessages = await importLocaleMessages(locale);
        if (!cancelled) {
          setMessages(loadedMessages);
          setHasInitialized(true);
        }
      } catch (error) {
        console.error('Failed to load locale messages', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const settings: SettingsState = await window.api.settings.get();
        if (cancelled) return;

        const storedLocale = safeLocalStorageGet(STORAGE_KEY);
        const hasLocaleInit = safeLocalStorageGet(LOCALE_INIT_KEY) === '1';
        const shouldAutoInitLocale =
          !hasLocaleInit && !isSupportedLocale(storedLocale);
        const detected = detectBrowserLocale();

        if (shouldAutoInitLocale) {
          safeLocalStorageSet(LOCALE_INIT_KEY, '1');
          if (
            isSupportedLocale(settings.language) &&
            settings.language !== detected
          ) {
            setLocaleState(detected);
            safeLocalStorageSet(STORAGE_KEY, detected);
            settingsApi.update({ language: detected }).catch((error) => {
              console.error('Failed to update initial language', error);
            });
            return;
          }
        }

        if (isSupportedLocale(settings.language)) {
          setLocaleState(settings.language);
          safeLocalStorageSet(STORAGE_KEY, settings.language);
        }
      } catch (error) {
        console.error('Failed to fetch initial language', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.api.settings.onChanged((diff: SettingsDiff) => {
      const next = diff.changed.language;
      if (isSupportedLocale(next)) {
        setLocaleState(next);
        safeLocalStorageSet(STORAGE_KEY, next);
      }
    });

    return () => {
      try {
        unsubscribe();
      } catch (error) {
        console.error('Failed to remove settings listener', error);
      }
    };
  }, []);

  const changeLocale = (next: SupportedLocale) => {
    setLocaleState(next);
    safeLocalStorageSet(STORAGE_KEY, next);
    settingsApi.update({ language: next }).catch((error) => {
      console.error('Failed to update language', error);
    });
  };

  const t = function translate(
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const raw = getNestedValue(messages, key);
    if (typeof raw === 'string') {
      return interpolate(raw, params);
    }
    if (typeof raw === 'number') {
      return String(raw);
    }
    return key;
  };

  const value: I18nContextValue = {
    locale,
    setLocale: changeLocale,
    t,
  };

  if (!hasInitialized) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
