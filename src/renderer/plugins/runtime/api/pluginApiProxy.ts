/**
 * 플러그인 API 프록시 생성
 * 각 플러그인에 대해 네임스페이스가 적용된 API 프록시를 생성합니다.
 */

import {
  createNamespacedStorage,
  wrapApiValue,
  wrapFunctionWithContext,
} from '../context';
import { createDefineElement } from './defineElement';
import { createDefineSettings } from './defineSettings';

interface CreatePluginApiProxyOptions {
  pluginId: string;
  registerCleanup: (cleanup: () => void) => void;
  isReloading: () => boolean;
  waitForReloadEnd: () => Promise<void>;
}

/**
 * 플러그인용 API 프록시를 생성합니다.
 */
export const createPluginApiProxy = (
  options: CreatePluginApiProxyOptions,
): typeof window.api => {
  const { pluginId, registerCleanup, isReloading, waitForReloadEnd } = options;

  const originalStorage = window.api.plugin.storage;
  const namespacedStorage = createNamespacedStorage(pluginId, originalStorage);

  const wrappedApi = wrapApiValue(window.api, pluginId) as Record<
    string,
    unknown
  > & {
    window?: Record<string, unknown>;
    plugin?: Record<string, unknown>;
  };

  const wrapWithContext = (fn: (...args: unknown[]) => unknown) =>
    wrapFunctionWithContext(fn, pluginId) as (...args: unknown[]) => unknown;

  const defineElement = createDefineElement({
    pluginId,
    namespacedStorage,
    registerCleanup,
    wrapFunctionWithContext: wrapWithContext,
    isReloading,
    waitForReloadEnd,
  });

  const defineSettings = createDefineSettings({
    pluginId,
    namespacedStorage,
    registerCleanup,
  });

  const proxiedApi = {
    ...wrappedApi,
    window: {
      ...(wrappedApi.window ?? {}),
      type: window.__dmn_window_type as 'main' | 'overlay',
    },
    plugin: {
      ...(wrappedApi.plugin ?? {}),
      storage: namespacedStorage,
      registerCleanup: (cleanup: () => void) => registerCleanup(cleanup),
      defineElement,
      defineSettings,
    },
  } as typeof window.api;

  return proxiedApi;
};

/**
 * 플러그인용 Window 프록시를 생성합니다.
 */
export const createPluginWindowProxy = (
  proxiedApi: typeof window.api,
): Window => {
  return new Proxy(window, {
    get(target, prop: string | symbol, receiver) {
      if (prop === 'api') return proxiedApi;
      if (prop === 'dmn') return proxiedApi; // dmn 별칭도 프록시된 API 반환
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop: string | symbol, value, receiver) {
      return Reflect.set(target, prop, value, receiver);
    },
  });
};
