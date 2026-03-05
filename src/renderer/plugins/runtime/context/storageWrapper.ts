/**
 * 플러그인 스토리지 래퍼
 * 플러그인별로 네임스페이스가 적용된 스토리지를 제공합니다.
 */

/**
 * 원본 스토리지 API를 플러그인 네임스페이스로 래핑합니다.
 */
export const createNamespacedStorage = (
  pluginId: string,
  originalStorage: typeof window.api.plugin.storage,
) => {
  return {
    get: async <T = any>(key: string) => {
      const prefixedKey = `${pluginId}/${key}`;
      return await originalStorage.get<T>(prefixedKey as string);
    },
    set: (key: string, value: any) =>
      originalStorage.set(`${pluginId}/${key}`, value),
    remove: (key: string) => originalStorage.remove(`${pluginId}/${key}`),
    clear: async () => {
      await originalStorage.clearByPrefix(pluginId);
    },
    keys: async () => {
      const allKeys = await originalStorage.keys();
      const prefix = `${pluginId}/`;
      return allKeys
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.substring(prefix.length));
    },
    hasData: originalStorage.hasData,
    clearByPrefix: originalStorage.clearByPrefix,
  };
};

export type NamespacedStorage = ReturnType<typeof createNamespacedStorage>;
