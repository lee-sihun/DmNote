/**
 * 커스텀 JS 런타임
 * 플러그인 JS 파일을 로드하고 실행하는 런타임입니다.
 *
 * 이 파일은 모듈화된 플러그인 시스템의 진입점으로,
 * 세부 구현은 하위 모듈들에서 처리됩니다.
 *
 * 모듈 구조:
 * - handlers/: 이벤트 핸들러 레지스트리
 * - displayElement/: 디스플레이 요소 관리
 * - context/: 플러그인 컨텍스트 (스토리지, 함수 래퍼)
 * - api/: defineElement, defineSettings 등 플러그인 API
 */

import { pluginAuthorityApi } from '@api/modules/pluginAuthorityApi';
import { internalApi } from '@api/internalApi';
import { setPluginAuthorityGeneration } from '@plugins/runtime/pluginAuthorityGeneration';
import { noteBackendPluginRevision } from '@plugins/runtime/pluginModelRevision';
import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';
import {
  pushDisplayElementsToOverlay,
  usePluginDisplayElementStore,
} from '@stores/plugin/usePluginDisplayElementStore';
import { extractPluginId } from '@utils/plugin/pluginUtils';
import {
  beginPluginWork,
  noteEnabledPluginCount,
  notePluginFetchSettled,
  resetPluginRuntimeReadiness,
} from './pluginRuntimeReadiness';
import { handlerRegistry } from './handlers';
import { displayElementInstanceRegistry } from './displayElement';
import { createPluginApiProxy, createPluginWindowProxy } from './api';
import type { JsPlugin } from '@src/types/plugin/js';

const SCRIPT_ID_PREFIX = 'dmn-custom-js-';

export interface CustomJsRuntime {
  initialize: () => void;
  dispose: () => void;
}

export function createCustomJsRuntime(): CustomJsRuntime {
  const activeElements = new Map<
    string,
    { element: HTMLScriptElement; cleanup?: () => void; pluginId?: string }
  >();
  const cleanupRegistry = new Map<string, (() => void)[]>();
  const unsubscribers: Array<() => void> = [];

  let enabled = false;
  let disposed = false;
  let currentPlugins: JsPlugin[] = [];
  // 마지막 주입 완료 시그니처 - 미주입·해제·주입 실패 시 null
  let appliedSignature: string | null = null;

  const pluginsSignature = (plugins: JsPlugin[]): string =>
    JSON.stringify(
      plugins.map((plugin) => [
        plugin.id,
        plugin.name,
        plugin.path,
        plugin.content,
        plugin.enabled,
      ]),
    );

  // 오버레이 리빌 게이트용 - 실제로 주입될 플러그인이 있는지 공표
  const publishEnabledPluginCount = () => {
    noteEnabledPluginCount(
      enabled
        ? currentPlugins.filter((plugin) => plugin.enabled && plugin.content)
            .length
        : 0,
    );
  };

  // 전역 플래그: removeAll/injectAll 실행 중에는 저장 비활성화
  let isReloading = false;
  const reloadSettledWaiters = new Set<() => void>();

  const getIsReloading = () => isReloading;
  const setReloading = (next: boolean) => {
    isReloading = next;
    if (next) return;
    const waiters = [...reloadSettledWaiters];
    reloadSettledWaiters.clear();
    waiters.forEach((resolve) => resolve());
  };
  const waitForReloadEnd = (): Promise<void> => {
    if (!isReloading) return Promise.resolve();
    return new Promise((resolve) => reloadSettledWaiters.add(resolve));
  };

  const safeRun = (fn?: () => void, label?: string) => {
    if (typeof fn !== 'function') return;
    try {
      fn();
    } catch (error) {
      const tag = label ? ` (${label})` : '';
      console.error(`Error during custom JS cleanup${tag}`, error);
    }
  };

  const registerCleanup = (pluginId: string, cleanup: () => void) => {
    if (typeof cleanup !== 'function') {
      console.warn(`[Plugin ${pluginId}] registerCleanup requires a function`);
      return;
    }
    if (!cleanupRegistry.has(pluginId)) {
      cleanupRegistry.set(pluginId, []);
    }
    cleanupRegistry.get(pluginId)!.push(cleanup);
  };

  const runPluginCleanups = (pluginId: string) => {
    const cleanups = cleanupRegistry.get(pluginId) || [];
    cleanups.forEach((cleanup, index) => {
      safeRun(cleanup, `${pluginId}[${index}]`);
    });
    cleanupRegistry.delete(pluginId);

    handlerRegistry.clearPlugin(pluginId);
  };

  const removeAll = () => {
    for (const [
      id,
      { element, cleanup, pluginId },
    ] of activeElements.entries()) {
      if (pluginId) {
        const previousPluginId = window.__dmn_current_plugin_id;
        window.__dmn_current_plugin_id = pluginId;

        runPluginCleanups(pluginId);

        if (cleanup) {
          safeRun(cleanup, id);
        }

        window.__dmn_current_plugin_id = previousPluginId;
      } else if (cleanup) {
        safeRun(cleanup, id);
      }

      if (element && element.parentNode) {
        element.remove();
      }
    }
    activeElements.clear();
    appliedSignature = null;

    if (window.__dmn_window_type === 'main') {
      try {
        usePluginMenuStore.getState().clearAll();
        usePluginDisplayElementStore.getState().setElements([]);
        displayElementInstanceRegistry.clearAll();

        pushDisplayElementsToOverlay();
      } catch (error) {
        console.error('Failed to clear plugin UI elements', error);
      }
    }
  };

  const injectPlugin = (plugin: JsPlugin) => {
    try {
      const previousCleanup = window.__dmn_custom_js_cleanup;
      if (previousCleanup) {
        delete window.__dmn_custom_js_cleanup;
      }

      const pluginId = extractPluginId(plugin.content, plugin.name);

      window.__dmn_current_plugin_id = pluginId;

      if (window.__dmn_window_type === 'main') {
        try {
          usePluginMenuStore.getState().clearByPluginId(pluginId);
          usePluginDisplayElementStore.getState().clearByPluginId(pluginId);
          displayElementInstanceRegistry.clearByPluginId(pluginId);

          pushDisplayElementsToOverlay();
        } catch (error) {
          console.error(
            `Failed to clear UI elements for plugin '${pluginId}'`,
            error,
          );
        }
      }

      // 플러그인용 API 프록시 생성
      const proxiedApi = createPluginApiProxy({
        pluginId,
        sourceApi: internalApi,
        registerCleanup: (cleanup) => registerCleanup(pluginId, cleanup),
        isReloading: getIsReloading,
        waitForReloadEnd,
      });

      // 플러그인용 Window 프록시 생성
      const proxyWindow = createPluginWindowProxy(proxiedApi);
      window.__dmn_plugin_window_proxy = proxyWindow;

      const wrappedContent = `
;(function(window){
  'use strict';
  const __PLUGIN_ID__ = "${pluginId}";
  
  // 플러그인 스코프에 dmn 별칭 추가 (window. 없이 바로 접근 가능)
  const dmn = window.api;
  
  const __autoWrapAsync__ = () => {
    const globalWindow = typeof window !== 'undefined' ? window : globalThis;
    const snapshot = Object.getOwnPropertyNames(globalWindow);
    
    snapshot.forEach(key => {
      try {
        const value = globalWindow[key];
        
        if (typeof value !== 'function') return;
        if (value.__dmn_wrapped__ || value.__dmn_plugin_wrapped__) return;
        
        if (key.startsWith('__dmn') || key === 'eval' || key === 'Function') return;
        
        const isAsync = value.constructor.name === 'AsyncFunction';
        
        if (isAsync) {
          const wrapped = async function(...args) {
            const prev = globalWindow.__dmn_current_plugin_id;
            globalWindow.__dmn_current_plugin_id = __PLUGIN_ID__;
            try {
              return await value.apply(this, args);
            } finally {
              globalWindow.__dmn_current_plugin_id = prev;
            }
          };
          wrapped.__dmn_wrapped__ = true;
          try {
            Object.defineProperty(wrapped, 'name', { value: key, configurable: true });
          } catch {}
          globalWindow[key] = wrapped;
        }
      } catch (e) {
      }
    });
  };
  
  try {
    // 사용자 코드를 격리를 위한 함수 스코프로 자동 래핑
    (function(){
${plugin.content}
    })();
  } catch (e) {
    console.error('Failed to run JS plugin: ${plugin.name}', e);
  }
  
  __autoWrapAsync__();
})(window.__dmn_plugin_window_proxy);
`;

      const element = document.createElement('script');
      element.id = `${SCRIPT_ID_PREFIX}${plugin.id}`;
      element.type = 'text/javascript';
      element.textContent = wrappedContent;
      document.head.appendChild(element);

      const pluginCleanup = window.__dmn_custom_js_cleanup;

      try {
        delete window.__dmn_plugin_window_proxy;
        delete window.__dmn_current_plugin_id;
      } catch {
        // 무시
      }

      if (previousCleanup) {
        window.__dmn_custom_js_cleanup = previousCleanup;
      } else {
        delete window.__dmn_custom_js_cleanup;
      }

      activeElements.set(plugin.id, {
        element,
        cleanup:
          typeof pluginCleanup === 'function' ? pluginCleanup : undefined,
        pluginId,
      });
    } catch (error) {
      console.error(`Failed to inject JS plugin '${plugin.name}'`, error);
    }
  };

  // main = 플러그인 단일 authority - 재주입 경계마다 generation 전진
  // reset 완료(새 generation 설치) 후에만 주입해 이전 generation 요청이
  // 새 runtime에 수용되거나 낡은 generation 스냅샷이 공개되지 않게 함
  const resetPluginAuthorityForRuntime = async (): Promise<boolean> => {
    if (window.__dmn_window_type !== 'main' || window.__dmn_runtime === 'obs') {
      return true;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const snapshot = await pluginAuthorityApi.reset();
        setPluginAuthorityGeneration(snapshot.authorityGeneration);
        noteBackendPluginRevision(snapshot.modelRevision);
        return true;
      } catch (error) {
        console.error('Failed to reset plugin authority', error);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return false;
  };

  // 재주입 세대 - reset 대기 중 다음 injectAll이 시작되면 이전 세대 주입을 중단
  let injectGeneration = 0;

  const injectAll = () => {
    // 주입 사이클이 끝나야 리빌 게이트가 열린다 - 모든 종료 경로에서 해제.
    // removeAll보다 먼저 - teardown이 내보내는 빈 요소 sync가 준비 완료로
    // 표시되면 그 순간 붙은 오버레이가 요소 0개 상태로 공개된다
    const endInjectionWork = beginPluginWork();
    setReloading(true);
    removeAll();
    injectGeneration += 1;
    const generation = injectGeneration;

    void resetPluginAuthorityForRuntime()
      .then((resetOk) => {
        if (disposed || generation !== injectGeneration) {
          endInjectionWork();
          return;
        }
        if (!resetOk) {
          // fail-closed - 이전 세대 요청·세션이 새 runtime에 유효로 남지 않게 주입 중단
          console.error('Skipping plugin injection: authority reset failed');
          setReloading(false);
          endInjectionWork();
          return;
        }
        if (!enabled) {
          setReloading(false);
          endInjectionWork();
          return;
        }

        currentPlugins
          .filter((plugin) => plugin.enabled && plugin.content)
          .forEach((plugin) => injectPlugin(plugin));
        // 주입이 실제 실행된 시점에만 기록 - reset 실패로 중단된 뒤 같은
        // 내용이 다시 오면 재시도가 가능해야 한다
        appliedSignature = pluginsSignature(currentPlugins);

        // 모든 플러그인의 복원이 완료될 때까지 딜레이 후 리로드 플래그 해제
        setTimeout(() => {
          endInjectionWork();
          if (generation !== injectGeneration) return;
          setReloading(false);
        }, 100);
      })
      .catch((error) => {
        // 주입 콜백 예외에도 리빌 게이트 카운터가 잔류하지 않게
        console.error('Plugin injection cycle failed', error);
        endInjectionWork();
        if (generation === injectGeneration) setReloading(false);
      });
  };

  const syncPlugins = (next: JsPlugin[], options?: { forced?: boolean }) => {
    const nextSignature = pluginsSignature(next);
    currentPlugins = next.map((plugin) => ({ ...plugin }));
    publishEnabledPluginCount();
    if (enabled) {
      // 내용 불변 재발행(프리셋 로드, JS 무관 undo 등)은 재주입 생략 -
      // 전 플러그인 teardown이 런타임 state·핸들을 파괴하는 것을 방지.
      // forced(명시 리로드)와 js:use 토글 경로는 가드를 타지 않는다
      if (!options?.forced && appliedSignature === nextSignature) return;
      injectAll();
    } else {
      removeAll();
      void resetPluginAuthorityForRuntime();
    }
  };

  const fetchInitialState = () => {
    internalApi.js
      .get()
      .then((data) => {
        if (disposed) return;
        syncPlugins(Array.isArray(data.plugins) ? data.plugins : []);
      })
      .catch((error) => {
        console.error('Failed to fetch JS plugins', error);
      })
      // 조회 실패는 fail-open - 게이트가 데드라인까지 닫혀 있지 않게 한다.
      // dispose 후 settle은 재생성된 사이클의 카운터를 건드리지 않는다
      .finally(() => {
        if (!disposed) notePluginFetchSettled();
      });

    internalApi.js
      .getUse()
      .then((value) => {
        if (disposed) return;
        enabled = value;
        publishEnabledPluginCount();
        if (enabled) {
          injectAll();
        } else {
          removeAll();
          void resetPluginAuthorityForRuntime();
        }
      })
      .catch((error) => {
        console.error('Failed to fetch JS plugin toggle state', error);
      })
      .finally(() => {
        if (!disposed) notePluginFetchSettled();
      });
  };

  const setupListeners = () => {
    const unsubUse = internalApi.js.onUse(({ enabled: next }) => {
      enabled = next;
      publishEnabledPluginCount();
      if (enabled) {
        injectAll();
      } else {
        removeAll();
        void resetPluginAuthorityForRuntime();
      }
    });

    const unsubState = internalApi.js.onState((payload) => {
      syncPlugins(Array.isArray(payload.plugins) ? payload.plugins : [], {
        forced: payload.forced === true,
      });
    });

    unsubscribers.push(unsubUse, unsubState);
  };

  const cleanupSubscriptions = () => {
    while (unsubscribers.length) {
      const unsubscribe = unsubscribers.pop();
      if (unsubscribe) {
        safeRun(() => unsubscribe());
      }
    }
  };

  const initialize = () => {
    fetchInitialState();
    setupListeners();
  };

  const dispose = () => {
    disposed = true;
    cleanupSubscriptions();
    removeAll();
    setReloading(false);
    resetPluginRuntimeReadiness();
  };

  return { initialize, dispose };
}
