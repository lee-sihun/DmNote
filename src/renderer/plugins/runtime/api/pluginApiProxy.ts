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
import type { DMNoteAPI } from '@src/types/plugin/api';

interface CreatePluginApiProxyOptions {
  pluginId: string;
  sourceApi: DMNoteAPI;
  registerCleanup: (cleanup: () => void) => void;
  isReloading: () => boolean;
  waitForReloadEnd: () => Promise<void>;
}

/**
 * 플러그인용 API 프록시를 생성합니다.
 */
export const createPluginApiProxy = (
  options: CreatePluginApiProxyOptions,
): DMNoteAPI => {
  const {
    pluginId,
    sourceApi,
    registerCleanup,
    isReloading,
    waitForReloadEnd,
  } = options;

  const originalStorage = sourceApi.plugin.storage;
  const namespacedStorage = createNamespacedStorage(pluginId, originalStorage);

  const wrappedApi = wrapApiValue(sourceApi, pluginId) as Record<
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
    api: sourceApi,
    namespacedStorage,
    registerCleanup,
    wrapFunctionWithContext: wrapWithContext,
    isReloading,
    waitForReloadEnd,
  });

  const defineSettings = createDefineSettings({
    pluginId,
    api: sourceApi,
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
  } as DMNoteAPI;

  return proxiedApi;
};

/**
 * 플러그인용 Window 프록시를 생성합니다.
 */
export const createPluginWindowProxy = (proxiedApi: DMNoteAPI): Window => {
  const isApiProperty = (prop: string | symbol) =>
    prop === 'api' || prop === 'dmn';

  return new Proxy(window, {
    get(target, prop: string | symbol, receiver) {
      if (isApiProperty(prop)) return proxiedApi;
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop: string | symbol) {
      if (isApiProperty(prop)) return true;
      return Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop: string | symbol) {
      if (isApiProperty(prop)) {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: proxiedApi,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    set(target, prop: string | symbol, value, receiver) {
      if (isApiProperty(prop)) return false;
      return Reflect.set(target, prop, value, receiver);
    },
    defineProperty(target, prop: string | symbol, attributes) {
      if (isApiProperty(prop)) return false;
      return Reflect.defineProperty(target, prop, attributes);
    },
    deleteProperty(target, prop: string | symbol) {
      if (isApiProperty(prop)) return false;
      return Reflect.deleteProperty(target, prop);
    },
  });
};
