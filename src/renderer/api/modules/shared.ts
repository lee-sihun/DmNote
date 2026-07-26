import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { ReadyUnsubscribe } from '@src/types/plugin/api';
import type { SettingsState, SettingsDiff } from '@src/types/settings/settings';

// ── subscribe helper ────────────────────────────────────────────────
export function subscribe<T>(
  event: string,
  listener: (payload: T) => void,
): ReadyUnsubscribe {
  const registration = listen<T>(event, ({ payload }) => listener(payload));
  const ready = registration.then(() => undefined);
  let unsubscribed = false;

  void ready.catch((error) => {
    console.error(`[API] Failed to subscribe to event "${event}":`, error);
  });

  const unsubscribe = () => {
    if (unsubscribed) return;
    unsubscribed = true;
    void registration.then(
      (unlisten) => {
        void Promise.resolve()
          .then(() => unlisten())
          .catch((error) => {
            console.error(
              `[API] Failed to unsubscribe from event "${event}":`,
              error,
            );
          });
      },
      () => undefined,
    );
  };

  return Object.assign(unsubscribe, { ready });
}

// ── i18n internals (shared between i18nApi and the settings listener) ──
const LOCALE_STORAGE_KEY = 'dmnote:locale';
const DEFAULT_LOCALE = 'ko';
const SUPPORTED_LOCALES = new Set(['ko', 'en', 'zh-cn', 'zh-Hant', 'ru']);

let cachedLocale: string | null = null;
const i18nListeners = new Set<(locale: string) => void>();

function initializeCachedLocale() {
  if (cachedLocale || typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.has(stored)) {
      cachedLocale = stored;
    }
  } catch (error) {
    console.warn('[I18n] Failed to read cached locale', error);
  }
}

export function notifyLocaleChanged(next: string) {
  if (!next || cachedLocale === next) return;
  cachedLocale = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch (error) {
      console.warn('[I18n] Failed to persist locale', error);
    }
  }
  i18nListeners.forEach((listener) => {
    try {
      listener(next);
    } catch (error) {
      console.error('[I18n] Locale listener failed', error);
    }
  });
}

initializeCachedLocale();

export function getCachedLocale(): string | null {
  return cachedLocale;
}

export function getDefaultLocale(): string {
  return DEFAULT_LOCALE;
}

export function getI18nListeners(): Set<(locale: string) => void> {
  return i18nListeners;
}

export async function fetchLocale(): Promise<string> {
  if (cachedLocale) {
    return cachedLocale;
  }
  try {
    const settings = await invoke<SettingsState>('settings_get');
    const next = settings.language || DEFAULT_LOCALE;
    notifyLocaleChanged(next);
    return next;
  } catch (error) {
    console.warn('[I18n] Failed to fetch locale', error);
    return cachedLocale || DEFAULT_LOCALE;
  }
}

// ── Settings listener for locale sync ──
subscribe<SettingsDiff>('settings:changed', (diff) => {
  const next = diff.changed.language;
  if (typeof next === 'string') {
    notifyLocaleChanged(next);
  }
});
