/**
 * 플러그인 스토리지 래퍼
 * 플러그인별로 네임스페이스가 적용된 스토리지를 제공합니다.
 */

import type { DMNoteAPI } from '@src/types/plugin/api';

/**
 * 원본 스토리지 API를 플러그인 네임스페이스로 래핑합니다.
 */
export const createNamespacedStorage = (
  pluginId: string,
  originalStorage: DMNoteAPI['plugin']['storage'],
) => {
  const namespace = `${pluginId}/`;
  const namespacedKey = (key: string) => `${namespace}${key}`;
  const namespacedPrefix = (prefix: string) =>
    prefix.startsWith(namespace) ? prefix : namespacedKey(prefix);

  return {
    get: async <T = unknown>(key: string) => {
      return await originalStorage.get<T>(namespacedKey(key));
    },
    set: (key: string, value: unknown) =>
      originalStorage.set(namespacedKey(key), value),
    remove: (key: string) => originalStorage.remove(namespacedKey(key)),
    clear: async () => {
      await originalStorage.clearByPrefix(namespace);
    },
    keys: async () => {
      const allKeys = await originalStorage.keys();
      return allKeys
        .filter((key) => key.startsWith(namespace))
        .map((key) => key.substring(namespace.length));
    },
    hasData: (prefix: string) =>
      originalStorage.hasData(namespacedPrefix(prefix)),
    clearByPrefix: (prefix: string) =>
      originalStorage.clearByPrefix(namespacedPrefix(prefix)),
  };
};

export type NamespacedStorage = ReturnType<typeof createNamespacedStorage>;
