import type { PluginMessages, PluginI18nParams } from '@src/types/api';

function getNestedValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (
      acc &&
      typeof acc === 'object' &&
      part in (acc as Record<string, unknown>)
    ) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function interpolate(template: string, params?: PluginI18nParams) {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}

export interface TranslatePluginMessageOptions {
  messages?: PluginMessages;
  locale: string;
  key?: string;
  params?: PluginI18nParams;
  fallback?: string;
}

export function translatePluginMessage({
  messages,
  locale,
  key,
  params,
  fallback,
}: TranslatePluginMessageOptions): string {
  if (!key) return fallback ?? '';

  const localeMessages = messages?.[locale];
  if (localeMessages) {
    // 먼저 평탄한 키로 직접 조회 시도 (예: "menu.create")
    let raw = localeMessages[key];

    // 없으면 중첩된 구조로 조회 (예: menu.create -> { menu: { create: "..." } })
    if (raw === undefined) {
      raw = getNestedValue(localeMessages, key);
    }

    if (typeof raw === 'string') {
      return interpolate(raw, params);
    }
    if (typeof raw === 'number') {
      return String(raw);
    }
  }

  // Fallback이 없으면 원본 키 반환
  return fallback ?? key;
}

export function createPluginTranslator(
  messages: PluginMessages | undefined,
  locale: string,
  fallback?: (key: string, params?: PluginI18nParams) => string,
) {
  return (key: string, params?: PluginI18nParams, defaultText?: string) =>
    translatePluginMessage({
      messages,
      locale,
      key,
      params,
      fallback: defaultText ?? fallback?.(key, params),
    });
}
