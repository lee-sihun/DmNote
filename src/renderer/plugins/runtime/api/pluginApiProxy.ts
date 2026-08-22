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
 * 모듈 로드 시점(플러그인 실행 이전) window에 존재하는 플랫폼 함수 집합.
 *
 * `[native code]` 문자열이나 own/inherited 같은 추측으로는 가를 수 없다.
 * bound 함수도, Proxy로 감싼 사용자 함수도 네이티브처럼 보이고
 * `setTimeout`은 브라우저에서 window의 own 프로퍼티다.
 * 그래서 추측 대신 신원으로 판별한다. 접근자는 값을 읽지 않으므로 부작용이 없다
 */
const pristineBuiltins: WeakSet<object> = (() => {
  const found = new WeakSet<object>();
  let level: object | null = window;
  while (level) {
    for (const key of Reflect.ownKeys(level)) {
      const value = Object.getOwnPropertyDescriptor(level, key)?.value;
      if (typeof value === 'function') found.add(value);
    }
    level = Object.getPrototypeOf(level);
  }
  return found;
})();

/**
 * 플러그인용 Window 프록시를 생성합니다.
 */
export const createPluginWindowProxy = (proxiedApi: DMNoteAPI): Window => {
  const isApiProperty = (prop: string | symbol) =>
    prop === 'api' || prop === 'dmn';

  // addEventListener나 setTimeout 같은 네이티브 메서드는 this가 실제 window여야 한다.
  // 프록시를 this로 받으면 brand check에서 TypeError가 난다.
  //
  // bind로 고정하지 않는다. bind는 수신자를 영구히 못박아
  // `saved.call(document, ...)` 같은 정당한 호출까지 window로 돌려버리고,
  // 정적 속성을 살리려면 프로토타입을 손대는 비규격 처리가 따라온다.
  // 호출 시점에 수신자가 이 프록시일 때만 실제 window로 바꾼다
  const wrappedBuiltins = new WeakMap<object, unknown>();
  let pluginWindow: Window | null = null;

  const wrapBuiltin = (
    target: Window,
    value: (...args: unknown[]) => unknown,
  ) => {
    const cached = wrappedBuiltins.get(value);
    if (cached) return cached;

    // Proxy는 get, 정적 속성, prototype, [[Construct]], instanceof를 그대로 넘긴다
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args: unknown[]) {
        const receiver =
          thisArg === undefined || thisArg === pluginWindow ? target : thisArg;
        return Reflect.apply(fn, receiver, args);
      },
    });

    wrappedBuiltins.set(value, wrapped);
    // 감싼 결과를 다시 조회해도 같은 참조가 나오게 자기 자신도 등록한다
    wrappedBuiltins.set(wrapped, wrapped);
    return wrapped;
  };

  const proxy = new Proxy(window, {
    get(target, prop: string | symbol) {
      if (isApiProperty(prop)) return proxiedApi;
      // receiver를 넘기지 않는다 - 네이티브 getter도 실제 window를 this로 받아야 한다
      const value = Reflect.get(target, prop);
      if (typeof value === 'function' && pristineBuiltins.has(value)) {
        return wrapBuiltin(target, value as (...args: unknown[]) => unknown);
      }
      return value;
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

  pluginWindow = proxy;
  return proxy;
};
