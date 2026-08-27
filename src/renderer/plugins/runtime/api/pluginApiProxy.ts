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
  /** 이 주입 세대가 회수됐는지 - 실패·제거된 플러그인의 잔존 핸들이 문서를 쓰지 못하게 */
  isRevoked?: () => boolean;
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
    isRevoked = () => false,
  } = options;

  // 쓰기 게이트: 회수된 세대의 타이머·구독 콜백이 뒤늦게 부르면 거절.
  // 세대별 클로저라 같은 id를 다시 주입해도 옛 핸들은 계속 막힌다
  const guardWrite = <T extends (...args: never[]) => unknown>(
    name: string,
    fn: T,
  ): ((...args: Parameters<T>) => ReturnType<T> | Promise<never>) =>
    ((...args: Parameters<T>) => {
      if (isRevoked()) {
        return Promise.reject(
          new Error(`[Plugin ${pluginId}] ${name}: plugin is no longer active`),
        );
      }
      return fn(...args) as ReturnType<T>;
    }) as (...args: Parameters<T>) => ReturnType<T> | Promise<never>;

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
      update: wrapWithContext(
        guardWrite('keys.update', (...args: unknown[]) =>
          pluginKeysUpdate(
            args[0] as Parameters<typeof pluginKeysUpdate>[0],
            args[1] as Parameters<typeof pluginKeysUpdate>[1],
          ),
        ),
      ),
      updateWithPositions: wrapWithContext(
        guardWrite('keys.updateWithPositions', (...args: unknown[]) =>
          pluginKeysUpdateWithPositions(
            args[0] as Parameters<typeof pluginKeysUpdateWithPositions>[0],
            args[1] as Parameters<typeof pluginKeysUpdateWithPositions>[1],
            args[2] as Parameters<typeof pluginKeysUpdateWithPositions>[2],
          ),
        ),
      ),
      // 위치 단독 쓰기도 격리 v1 - 자사 큐를 타면 wire v2가 되어 무ID
      // 구 플러그인 입력이 거절된다
      updatePositions: wrapWithContext(
        guardWrite('keys.updatePositions', (...args: unknown[]) =>
          pluginPositionsUpdate(
            'keyPositions',
            args[0] as Record<string, unknown[]>,
          ),
        ),
      ),
    },
    statItems: {
      ...((wrappedApi.statItems as Record<string, unknown>) ?? {}),
      updatePositions: wrapWithContext(
        guardWrite('statItems.updatePositions', (...args: unknown[]) =>
          pluginPositionsUpdate(
            'statPositions',
            args[0] as Record<string, unknown[]>,
          ),
        ),
      ),
    },
    graphItems: {
      ...((wrappedApi.graphItems as Record<string, unknown>) ?? {}),
      updatePositions: wrapWithContext(
        guardWrite('graphItems.updatePositions', (...args: unknown[]) =>
          pluginPositionsUpdate(
            'graphPositions',
            args[0] as Record<string, unknown[]>,
          ),
        ),
      ),
    },
    knobItems: {
      ...((wrappedApi.knobItems as Record<string, unknown>) ?? {}),
      updatePositions: wrapWithContext(
        guardWrite('knobItems.updatePositions', (...args: unknown[]) =>
          pluginPositionsUpdate(
            'knobPositions',
            args[0] as Record<string, unknown[]>,
          ),
        ),
      ),
    },
    editor: {
      ...((wrappedApi.editor as Record<string, unknown>) ?? {}),
      commit: wrapWithContext(
        guardWrite('editor.commit', (...args: unknown[]) =>
          pluginEditorCommit(
            args[0] as Parameters<typeof pluginEditorCommit>[0],
          ),
        ),
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
      // 비동기 콜백에서 불러도 컨텍스트 id가 서게 - 내부의 메뉴 등록이 호스트
      // uiApi의 컨텍스트 가드를 통과해야 한다
      defineElement: wrapWithContext(
        defineElement as (...args: unknown[]) => unknown,
      ),
      defineSettings: wrapWithContext(
        defineSettings as (...args: unknown[]) => unknown,
      ),
    },
  } as DMNoteAPI;

  return proxiedApi;
};
