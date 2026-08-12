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
import {
  pluginEditorCommit,
  pluginKeysUpdate,
  pluginKeysUpdateWithPositions,
  pluginPositionsUpdate,
} from './pluginWriteGateway';

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
    // 플러그인 발신 keys·editor 쓰기는 게이트웨이로 명시 라우팅 (계약 §10)
    // provenance를 전역 상태가 아니라 프록시 클로저로 결정
    keys: {
      ...((wrappedApi.keys as Record<string, unknown>) ?? {}),
      update: wrapWithContext((...args: unknown[]) =>
        pluginKeysUpdate(
          args[0] as Parameters<typeof pluginKeysUpdate>[0],
          args[1] as Parameters<typeof pluginKeysUpdate>[1],
        ),
      ),
      updateWithPositions: wrapWithContext((...args: unknown[]) =>
        pluginKeysUpdateWithPositions(
          args[0] as Parameters<typeof pluginKeysUpdateWithPositions>[0],
          args[1] as Parameters<typeof pluginKeysUpdateWithPositions>[1],
          args[2] as Parameters<typeof pluginKeysUpdateWithPositions>[2],
        ),
      ),
      // 위치 단독 쓰기도 격리 v1 - 자사 큐를 타면 wire v2가 되어 무ID
      // 구 플러그인 입력이 거절된다
      updatePositions: wrapWithContext((...args: unknown[]) =>
        pluginPositionsUpdate(
          'keyPositions',
          args[0] as Record<string, unknown[]>,
        ),
      ),
    },
    statItems: {
      ...((wrappedApi.statItems as Record<string, unknown>) ?? {}),
      updatePositions: wrapWithContext((...args: unknown[]) =>
        pluginPositionsUpdate(
          'statPositions',
          args[0] as Record<string, unknown[]>,
        ),
      ),
    },
    graphItems: {
      ...((wrappedApi.graphItems as Record<string, unknown>) ?? {}),
      updatePositions: wrapWithContext((...args: unknown[]) =>
        pluginPositionsUpdate(
          'graphPositions',
          args[0] as Record<string, unknown[]>,
        ),
      ),
    },
    knobItems: {
      ...((wrappedApi.knobItems as Record<string, unknown>) ?? {}),
      updatePositions: wrapWithContext((...args: unknown[]) =>
        pluginPositionsUpdate(
          'knobPositions',
          args[0] as Record<string, unknown[]>,
        ),
      ),
    },
    editor: {
      ...((wrappedApi.editor as Record<string, unknown>) ?? {}),
      commit: wrapWithContext((...args: unknown[]) =>
        pluginEditorCommit(args[0] as Parameters<typeof pluginEditorCommit>[0]),
      ),
    },
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
