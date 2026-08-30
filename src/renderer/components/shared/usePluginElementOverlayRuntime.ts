import { useEffect, useRef } from 'react';
import { obsApi } from '@api/modules/obsApi';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type {
  ElementResizeAnchor,
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
  PluginTranslateFn,
} from '@src/types/plugin/api';
import {
  clearExposedActions,
  registerExposedActions,
} from '@utils/displayElementActions';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { normalizeStateKeys } from '@utils/plugin/pluginMenuRuntimeState';

type SettingsChangeListener = (
  newSettings: Record<string, unknown>,
  oldSettings: Record<string, unknown>,
) => void;

interface RuntimeRef<T> {
  current: T;
}

interface UsePluginElementOverlayRuntimeOptions {
  windowType: 'main' | 'overlay';
  definition: PluginDefinitionInternal | undefined;
  element: PluginDisplayElementInternal;
  updateElement: (
    fullId: string,
    updates: Partial<PluginDisplayElementInternal>,
    options?: { skipSync?: boolean },
  ) => void;
  updateElementBatched: (
    fullId: string,
    updates: Partial<PluginDisplayElementInternal>,
  ) => void;
  localeRef: RuntimeRef<string>;
  pluginTranslateStable: PluginTranslateFn;
  settingsChangeListenersRef: RuntimeRef<Set<SettingsChangeListener>>;
}

export const usePluginElementOverlayRuntime = ({
  windowType,
  definition,
  element,
  updateElement,
  updateElementBatched,
  localeRef,
  pluginTranslateStable,
  settingsChangeListenersRef,
}: UsePluginElementOverlayRuntimeOptions) => {
  const exposedActionsRef = useRef<
    Record<string, (...args: unknown[]) => unknown>
  >({});

  // Overlay 로직 (onMount)
  useEffect(() => {
    if (windowType !== 'overlay') return;

    if (!definition) {
      // definition이 아직 로드되지 않았을 수 있음.
      // definitions가 업데이트되면 리렌더링되므로 그때 다시 시도됨.
      return;
    }

    if (!definition.onMount) return;

    // 이전 expose 액션 초기화
    exposedActionsRef.current = {};
    clearExposedActions(element.fullId);

    const cleanups: (() => void)[] = [];

    // 메뉴 predicate용 선언 키(contextMenuStateKeys) 동기화 —
    // 스토어는 rAF 배치라 동기 shadow에서 diff를 계산해 변경분만 송신
    const menuStateKeys = normalizeStateKeys(definition.contextMenuStateKeys);
    const latestState: Record<string, unknown> = {
      ...(usePluginDisplayElementStore
        .getState()
        .elements.find((el) => el.fullId === element.fullId)?.state ?? {}),
    };
    const lastSentMenuState: Record<string, unknown> = {};
    const sendMenuStateSync = () => {
      if (menuStateKeys.length === 0) return;
      const changed: Record<string, unknown> = {};
      for (const key of menuStateKeys) {
        if (!Object.prototype.hasOwnProperty.call(latestState, key)) continue;
        const value = latestState[key];
        if (
          Object.prototype.hasOwnProperty.call(lastSentMenuState, key) &&
          Object.is(lastSentMenuState[key], value)
        ) {
          continue;
        }
        changed[key] = value;
        lastSentMenuState[key] = value;
      }
      if (Object.keys(changed).length === 0) return;
      sendBridgeMessageBestEffort(
        'main',
        'plugin:displayElement:syncMenuState',
        { fullId: element.fullId, state: changed },
      );
    };

    // OBS WS 재연결 시 단절 중 유실됐을 수 있는 제어 상태 재송신
    if (menuStateKeys.length > 0) {
      const unsubMenuStateResync = obsApi.onResync(() => {
        Object.keys(lastSentMenuState).forEach((key) => {
          delete lastSentMenuState[key];
        });
        sendMenuStateSync();
      });
      cleanups.push(unsubMenuStateResync);
    }

    const context = {
      setState: (updates: Record<string, unknown>) => {
        Object.assign(latestState, updates);
        // rAF 기반 배치 업데이트 사용 (성능 최적화)
        const currentElement = usePluginDisplayElementStore
          .getState()
          .elements.find((el) => el.fullId === element.fullId);
        if (currentElement) {
          updateElementBatched(element.fullId, {
            state: { ...currentElement.state, ...updates },
          });
        }
        sendMenuStateSync();
      },
      getSettings: () => {
        const currentElement = usePluginDisplayElementStore
          .getState()
          .elements.find((el) => el.fullId === element.fullId);
        return currentElement?.settings || {};
      },
      setAnchor: (anchor: ElementResizeAnchor) => {
        // 오버레이 로컬 스토어 업데이트
        updateElement(element.fullId, { resizeAnchor: anchor });
        // 메인 윈도우로 동기화 (브릿지 통해)
        sendBridgeMessageBestEffort(
          'main',
          'plugin:displayElement:updateAnchor',
          {
            fullId: element.fullId,
            resizeAnchor: anchor,
          },
        );
      },
      getAnchor: (): ElementResizeAnchor => {
        const currentElement = usePluginDisplayElementStore
          .getState()
          .elements.find((el) => el.fullId === element.fullId);
        return (
          currentElement?.resizeAnchor || definition?.resizeAnchor || 'top-left'
        );
      },
      onHook: (event: string, callback: (...args: unknown[]) => void) => {
        // console.log(`[PluginElement] onHook registered for ${event}`);
        if (event === 'key') {
          // 백엔드 재구독 대신 키 이벤트 버스 사용
          import('@utils/core/keyEventBus').then(({ keyEventBus }) => {
            const unsub = keyEventBus.subscribe((payload) => {
              // console.log(`[PluginElement] Key event received via hook`, payload);
              callback(payload);
            });
            cleanups.push(unsub);
          });
        } else if (event === 'rawKey') {
          // Raw key 이벤트 버스 사용 (구독 기반 - 구독자가 있을 때만 백엔드가 emit)
          import('@utils/core/rawKeyEventBus').then(({ rawKeyEventBus }) => {
            rawKeyEventBus
              .subscribe((payload) => {
                callback(payload);
              })
              .then((unsub) => {
                cleanups.push(unsub);
              })
              .catch((error) => {
                console.error(
                  `[PluginElement] Failed to subscribe to rawKey:`,
                  error,
                );
              });
          });
        }
      },
      expose: (actions: Record<string, (...args: unknown[]) => unknown>) => {
        if (!actions || typeof actions !== 'object') return;
        const validEntries = Object.entries(actions).filter(
          ([, fn]) => typeof fn === 'function',
        );
        if (validEntries.length === 0) return;

        exposedActionsRef.current = {
          ...exposedActionsRef.current,
          ...Object.fromEntries(validEntries),
        };
        registerExposedActions(element.fullId, exposedActionsRef.current);
      },
      locale: localeRef.current,
      t: pluginTranslateStable,
      onLocaleChange: (listener: (locale: string) => void) => {
        if (window.api?.i18n?.onLocaleChange) {
          return window.api.i18n.onLocaleChange(listener);
        }
        console.warn(
          '[PluginElement] i18n API is not available in this context',
        );
        return () => undefined;
      },
      onSettingsChange: (listener: SettingsChangeListener) => {
        settingsChangeListenersRef.current.add(listener);
        cleanups.push(() => {
          settingsChangeListenersRef.current.delete(listener);
        });
      },
    };

    console.warn(`[PluginElement] Mounting ${element.fullId}`);

    try {
      const mountCleanup = definition.onMount(context);
      if (typeof mountCleanup === 'function') {
        cleanups.push(mountCleanup);
      }
    } catch (error) {
      console.error(
        `[PluginElement] onMount failed for ${element.fullId}:`,
        error,
      );
    }

    // 동기 onMount 완료 후 초기 1회 송신 — 이미 setState로 보낸 키는 dedup됨
    sendMenuStateSync();

    return () => {
      clearExposedActions(element.fullId);
      exposedActionsRef.current = {};
      cleanups.forEach((fn) => fn());
    };
  }, [windowType, definition?.id, element.fullId, updateElementBatched]); // eslint-disable-line react-hooks/exhaustive-deps
};
