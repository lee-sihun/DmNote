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
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { usePluginHealthStore } from '@stores/plugin/usePluginHealthStore';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { extractPluginId } from '@utils/plugin/pluginUtils';
import { handlerRegistry } from './handlers';
import { displayElementInstanceRegistry } from './displayElement';
import { createPluginApiProxy } from './api';
import type { DMNoteAPI } from '@src/types/plugin/api';
import type { JsPlugin } from '@src/types/plugin/js';
import type {
  PluginHealthEntry,
  PluginHealthMap,
  PluginInjectionOutcome,
} from '@stores/plugin/usePluginHealthStore';

const SCRIPT_ID_PREFIX = 'dmn-custom-js-';

/** 플러그인별 API를 실어 나르는 script element */
type PluginScriptElement = HTMLScriptElement & {
  __dmn_plugin_api?: DMNoteAPI;
};

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

  // 주입 결과는 main 창의 관리 목록과 알림이 쓴다
  const publishHealth = (
    outcome: PluginInjectionOutcome,
    health: PluginHealthMap = {},
  ) => {
    if (disposed) return;
    usePluginHealthStore.getState().publish(outcome, health);
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

  const clearPluginUi = (pluginId: string) => {
    if (window.__dmn_window_type !== 'main') return;
    try {
      usePluginMenuStore.getState().clearByPluginId(pluginId);
      usePluginDisplayElementStore.getState().clearByPluginId(pluginId);
      displayElementInstanceRegistry.clearByPluginId(pluginId);

      sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
        elements: usePluginDisplayElementStore.getState().elements,
      });
    } catch (error) {
      console.error(
        `Failed to clear UI elements for plugin '${pluginId}'`,
        error,
      );
    }
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

        sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
          elements: [],
        });
      } catch (error) {
        console.error('Failed to clear plugin UI elements', error);
      }
    }
  };

  const injectPlugin = (plugin: JsPlugin): PluginHealthEntry => {
    const pluginId = extractPluginId(plugin.content, plugin.name);
    const previousCleanup = window.__dmn_custom_js_cleanup;
    const previousPluginId = window.__dmn_current_plugin_id;
    let element: HTMLScriptElement | null = null;
    let committed = false;

    try {
      if (previousCleanup) {
        delete window.__dmn_custom_js_cleanup;
      }

      window.__dmn_current_plugin_id = pluginId;

      clearPluginUi(pluginId);

      // 플러그인용 API 프록시 생성
      const proxiedApi = createPluginApiProxy({
        pluginId,
        sourceApi: internalApi,
        registerCleanup: (cleanup) => registerCleanup(pluginId, cleanup),
        isReloading: getIsReloading,
        waitForReloadEnd,
      });

      const wrappedContent = `
;(function(window, dmn){
  'use strict';
  const __PLUGIN_ID__ = "${pluginId}";
  
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
    console.error('Failed to run JS plugin: ' + ${JSON.stringify(
      plugin.name,
    )}, e);
    // 주입 직후 런타임이 회수한다 - 삼키면 실패가 성공처럼 보인다
    window.__dmn_plugin_run_error = e && e.message ? String(e.message) : String(e);
  }
  
  __autoWrapAsync__();
  // 끝까지 도달했다는 표시 - 문법 오류나 래퍼 자체의 예외를 여기서 가른다
  window.__dmn_plugin_ran = true;
})(window, document.currentScript.__dmn_plugin_api);
`;

      element = document.createElement('script');
      element.id = `${SCRIPT_ID_PREFIX}${plugin.id}`;
      element.type = 'text/javascript';
      element.textContent = wrappedContent;
      // 공유 전역 대신 이 script element로만 전달한다.
      // 동기 평가 중 document.currentScript가 이 요소를 가리킨다
      (element as PluginScriptElement).__dmn_plugin_api = proxiedApi;

      // 인라인 script의 문법 오류는 appendChild 호출자에게 예외로 오지 않고
      // window error 이벤트로만 보고된다 (HTML 스펙 run a classic script).
      // 다만 이 구간의 error 이벤트가 전부 이 플러그인의 실패는 아니다.
      // 실패 판정은 완주 여부로 하고, 이 메시지는 완주하지 못했을 때 사유로만 쓴다
      let observedErrorMessage: string | undefined;
      const captureParseError = (event: ErrorEvent): void => {
        observedErrorMessage ??= event.message || 'SyntaxError';
      };
      window.addEventListener('error', captureParseError, true);
      delete window.__dmn_plugin_ran;
      try {
        document.head.appendChild(element);
      } finally {
        window.removeEventListener('error', captureParseError, true);
      }

      // 오류가 없었다는 것으로 성공을 추정하지 않는다. CSP 차단처럼 평가 자체가
      // 일어나지 않으면 오류 이벤트도 없으므로 완주 여부를 직접 확인한다
      const completed = window.__dmn_plugin_ran === true;
      delete window.__dmn_plugin_ran;
      delete (element as PluginScriptElement).__dmn_plugin_api;
      const runErrorMessage = window.__dmn_plugin_run_error;
      delete window.__dmn_plugin_run_error;

      const pluginCleanup = window.__dmn_custom_js_cleanup;

      // 완주했으면 성공이다. 실행 중 관측된 error 이벤트는 이 플러그인이 낸
      // 진단일 수 있으므로 완주 결과를 뒤집지 않는다
      const failure = completed
        ? runErrorMessage
        : observedErrorMessage ?? 'Plugin script was not evaluated';
      if (failure) {
        return { status: 'failed' as const, message: failure };
      }

      activeElements.set(plugin.id, {
        element,
        cleanup:
          typeof pluginCleanup === 'function' ? pluginCleanup : undefined,
        pluginId,
      });
      committed = true;
      return { status: 'ok' as const };
    } catch (error) {
      console.error(`Failed to inject JS plugin '${plugin.name}'`, error);
      return {
        status: 'failed' as const,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // 전역 복원과 실패 회수는 모든 탈출 경로에서 일어나야 한다.
      // 복원을 빠뜨리면 다음 플러그인이 남의 컨텍스트로 주입된다
      try {
        delete window.__dmn_plugin_ran;
        delete window.__dmn_plugin_run_error;
      } catch {
        // 무시
      }

      if (!committed) {
        // 사용자 코드가 throw 전에 등록한 UI·handler·cleanup을 되돌린다.
        // 실패한 플러그인의 반쪽 기능이 정상 항목과 나란히 남으면 안 된다
        window.__dmn_current_plugin_id = pluginId;
        runPluginCleanups(pluginId);
        safeRun(window.__dmn_custom_js_cleanup, plugin.id);
        clearPluginUi(pluginId);
        element?.remove();
      }

      // 진입 전 값으로 되돌린다 - 삭제로 끝내면 바깥 소유자 정보가 사라진다
      try {
        if (previousPluginId !== undefined) {
          window.__dmn_current_plugin_id = previousPluginId;
        } else {
          delete window.__dmn_current_plugin_id;
        }
        if (previousCleanup) {
          window.__dmn_custom_js_cleanup = previousCleanup;
        } else {
          delete window.__dmn_custom_js_cleanup;
        }
      } catch {
        // 무시
      }
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

  // 전역 OFF - 켜져 있던 동안의 오류 상태를 그대로 두면 지금도 실패 중으로 보인다
  const disableRuntime = () => {
    removeAll();
    publishHealth('skipped');
    void resetPluginAuthorityForRuntime();
  };

  const injectAll = () => {
    setReloading(true);
    removeAll();
    injectGeneration += 1;
    const generation = injectGeneration;

    void resetPluginAuthorityForRuntime().then((resetOk) => {
      if (disposed || generation !== injectGeneration) return;
      if (!resetOk) {
        // fail-closed - 이전 세대 요청·세션이 새 runtime에 유효로 남지 않게 주입 중단
        console.error('Skipping plugin injection: authority reset failed');
        // 주입이 아예 일어나지 않았다. 빈 결과를 성공으로 읽히게 두면 안 된다
        publishHealth('aborted');
        setReloading(false);
        return;
      }
      if (!enabled) {
        publishHealth('skipped');
        setReloading(false);
        return;
      }

      const health: PluginHealthMap = {};
      currentPlugins
        .filter((plugin) => plugin.enabled && plugin.content)
        .forEach((plugin) => {
          health[plugin.id] = injectPlugin(plugin);
        });
      publishHealth('settled', health);
      // 주입이 실제 실행된 시점에만 기록 - reset 실패로 중단된 뒤 같은
      // 내용이 다시 오면 재시도가 가능해야 한다
      appliedSignature = pluginsSignature(currentPlugins);

      // 모든 플러그인의 복원이 완료될 때까지 딜레이 후 리로드 플래그 해제
      setTimeout(() => {
        if (generation !== injectGeneration) return;
        setReloading(false);
      }, 100);
    });
  };

  const syncPlugins = (next: JsPlugin[], options?: { forced?: boolean }) => {
    const nextSignature = pluginsSignature(next);
    currentPlugins = next.map((plugin) => ({ ...plugin }));
    if (enabled) {
      // 내용 불변 재발행(프리셋 로드, JS 무관 undo 등)은 재주입 생략 -
      // 전 플러그인 teardown이 런타임 state·핸들을 파괴하는 것을 방지.
      // forced(명시 리로드)와 js:use 토글 경로는 가드를 타지 않는다
      if (!options?.forced && appliedSignature === nextSignature) return;
      injectAll();
    } else {
      disableRuntime();
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
      });

    internalApi.js
      .getUse()
      .then((value) => {
        if (disposed) return;
        enabled = value;
        if (enabled) {
          injectAll();
        } else {
          disableRuntime();
        }
      })
      .catch((error) => {
        console.error('Failed to fetch JS plugin toggle state', error);
      });
  };

  const setupListeners = () => {
    const unsubUse = internalApi.js.onUse(({ enabled: next }) => {
      enabled = next;
      if (enabled) {
        injectAll();
      } else {
        disableRuntime();
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
  };

  return { initialize, dispose };
}
