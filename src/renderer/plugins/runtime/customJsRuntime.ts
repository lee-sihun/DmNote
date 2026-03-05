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

import { usePluginMenuStore } from '@stores/usePluginMenuStore';
import { usePluginDisplayElementStore } from '@stores/usePluginDisplayElementStore';
import { extractPluginId } from '@utils/plugin/pluginUtils';
import { handlerRegistry } from './handlers';
import {
  displayElementInstanceRegistry,
  setInitialLoading,
} from './displayElement';
import { createPluginApiProxy, createPluginWindowProxy } from './api';
import type { JsPlugin } from '@src/types/js';

const SCRIPT_ID_PREFIX = 'dmn-custom-js-';

type CleanupAwareWindow = Window & {
  __dmn_custom_js_cleanup?: () => void;
};

export interface CustomJsRuntime {
  initialize: () => void;
  dispose: () => void;
}

export function createCustomJsRuntime(): CustomJsRuntime {
  const anyWindow = window as unknown as CleanupAwareWindow;
  const activeElements = new Map<
    string,
    { element: HTMLScriptElement; cleanup?: () => void; pluginId?: string }
  >();
  const cleanupRegistry = new Map<string, (() => void)[]>();
  const unsubscribers: Array<() => void> = [];

  let enabled = false;
  let disposed = false;
  let currentPlugins: JsPlugin[] = [];

  // 전역 플래그: removeAll/injectAll 실행 중에는 저장 비활성화
  let isReloading = false;

  const getIsReloading = () => isReloading;

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
        const previousPluginId = (window as any).__dmn_current_plugin_id;
        (window as any).__dmn_current_plugin_id = pluginId;

        runPluginCleanups(pluginId);

        if (cleanup) {
          safeRun(cleanup, id);
        }

        (window as any).__dmn_current_plugin_id = previousPluginId;
      } else if (cleanup) {
        safeRun(cleanup, id);
      }

      if (element && element.parentNode) {
        element.remove();
      }
    }
    activeElements.clear();

    if ((window as any).__dmn_window_type === 'main') {
      try {
        usePluginMenuStore.getState().clearAll();
        usePluginDisplayElementStore.getState().setElements([]);
        displayElementInstanceRegistry.clearAll();

        if (window.api?.bridge) {
          window.api.bridge.sendTo('overlay', 'plugin:displayElements:sync', {
            elements: [],
          });
        }
      } catch (error) {
        console.error('Failed to clear plugin UI elements', error);
      }
    }
  };

  const injectPlugin = (plugin: JsPlugin) => {
    try {
      const previousCleanup = anyWindow.__dmn_custom_js_cleanup;
      if (previousCleanup) {
        delete anyWindow.__dmn_custom_js_cleanup;
      }

      const pluginId = extractPluginId(plugin.content, plugin.name);

      (anyWindow as any).__dmn_current_plugin_id = pluginId;

      if ((window as any).__dmn_window_type === 'main') {
        try {
          usePluginMenuStore.getState().clearByPluginId(pluginId);
          usePluginDisplayElementStore.getState().clearByPluginId(pluginId);
          displayElementInstanceRegistry.clearByPluginId(pluginId);

          if (window.api?.bridge) {
            window.api.bridge.sendTo('overlay', 'plugin:displayElements:sync', {
              elements: usePluginDisplayElementStore.getState().elements,
            });
          }
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
        registerCleanup: (cleanup) => registerCleanup(pluginId, cleanup),
        isReloading: getIsReloading,
      });

      // 플러그인용 Window 프록시 생성
      const proxyWindow = createPluginWindowProxy(proxiedApi);
      (anyWindow as any).__dmn_plugin_window_proxy = proxyWindow;

      const wrappedContent = `
;(function(window){
  'use strict';
  const __PLUGIN_ID__ = "${pluginId}";
  
  // dmn을 전역 변수로 추가 (window. 없이 바로 접근 가능)
  const dmn = window.api;
  if (typeof globalThis !== 'undefined') {
    globalThis.dmn = window.api;
  }
  
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

      const pluginCleanup = anyWindow.__dmn_custom_js_cleanup;

      try {
        delete (anyWindow as any).__dmn_plugin_window_proxy;
        delete (anyWindow as any).__dmn_current_plugin_id;
      } catch {
        // 무시
      }

      if (previousCleanup) {
        anyWindow.__dmn_custom_js_cleanup = previousCleanup;
      } else {
        delete anyWindow.__dmn_custom_js_cleanup;
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

  const injectAll = () => {
    isReloading = true;
    setInitialLoading(true);
    removeAll();
    if (!enabled) {
      isReloading = false;
      setInitialLoading(false);
      return;
    }

    currentPlugins
      .filter((plugin) => plugin.enabled && plugin.content)
      .forEach((plugin) => injectPlugin(plugin));

    // 모든 플러그인의 복원이 완료될 때까지 딜레이 후 리로드 플래그 해제
    setTimeout(() => {
      isReloading = false;
      setInitialLoading(false);
    }, 100);
  };

  const syncPlugins = (next: JsPlugin[]) => {
    currentPlugins = next.map((plugin) => ({ ...plugin }));
    if (enabled) {
      injectAll();
    } else {
      removeAll();
    }
  };

  const fetchInitialState = () => {
    window.api.js
      .get()
      .then((data) => {
        if (disposed) return;
        syncPlugins(Array.isArray(data.plugins) ? data.plugins : []);
      })
      .catch((error) => {
        console.error('Failed to fetch JS plugins', error);
      });

    window.api.js
      .getUse()
      .then((value) => {
        if (disposed) return;
        enabled = value;
        if (enabled) {
          injectAll();
        } else {
          removeAll();
        }
      })
      .catch((error) => {
        console.error('Failed to fetch JS plugin toggle state', error);
      });
  };

  const setupListeners = () => {
    const unsubUse = window.api.js.onUse(({ enabled: next }) => {
      enabled = next;
      if (enabled) {
        injectAll();
      } else {
        removeAll();
      }
    });

    const unsubState = window.api.js.onState((payload) => {
      syncPlugins(Array.isArray(payload.plugins) ? payload.plugins : []);
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
  };

  return { initialize, dispose };
}
