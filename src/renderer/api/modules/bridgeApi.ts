import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type {
  BridgeMessage,
  BridgeMessageListener,
  BridgeAnyListener,
  WindowTarget,
} from '@src/types/plugin/api';

export const bridgeApi = (() => {
  const listeners = new Map<string, Set<BridgeMessageListener>>();
  const anyListeners = new Set<BridgeAnyListener>();
  const onceListeners = new Map<string, Set<BridgeMessageListener>>();

  // 백엔드에서 브로드캐스트한 메시지 수신
  listen<BridgeMessage>('plugin-bridge:message', ({ payload }) => {
    const { type, data } = payload;

    // 타입별 리스너 호출
    const typeListeners = listeners.get(type);
    if (typeListeners) {
      typeListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`[Bridge] Error in listener for '${type}':`, error);
        }
      });
    }

    // once 리스너 호출 및 제거
    const onceTypeListeners = onceListeners.get(type);
    if (onceTypeListeners) {
      onceTypeListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(
            `[Bridge] Error in once listener for '${type}':`,
            error,
          );
        }
      });
      onceListeners.delete(type);
    }

    // any 리스너 호출
    anyListeners.forEach((listener) => {
      try {
        listener(type, data);
      } catch (error) {
        console.error('[Bridge] Error in any listener:', error);
      }
    });
  }).catch((error) => {
    console.error('[Bridge] Failed to setup message listener:', error);
  });

  return {
    send: (type: string, data?: unknown) =>
      invoke<void>('plugin_bridge_send', {
        messageType: type,
        data: data ?? null,
      }),

    sendTo: (target: WindowTarget, type: string, data?: unknown) =>
      invoke<void>('plugin_bridge_send_to', {
        target,
        messageType: type,
        data: data ?? null,
      }),

    on: <T = unknown>(type: string, listener: BridgeMessageListener<T>) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener as BridgeMessageListener);

      return () => {
        const typeListeners = listeners.get(type);
        if (typeListeners) {
          typeListeners.delete(listener as BridgeMessageListener);
          if (typeListeners.size === 0) {
            listeners.delete(type);
          }
        }
      };
    },

    once: <T = unknown>(type: string, listener: BridgeMessageListener<T>) => {
      if (!onceListeners.has(type)) {
        onceListeners.set(type, new Set());
      }
      onceListeners.get(type)!.add(listener as BridgeMessageListener);

      return () => {
        const typeListeners = onceListeners.get(type);
        if (typeListeners) {
          typeListeners.delete(listener as BridgeMessageListener);
          if (typeListeners.size === 0) {
            onceListeners.delete(type);
          }
        }
      };
    },

    onAny: (listener: BridgeAnyListener) => {
      anyListeners.add(listener);
      return () => {
        anyListeners.delete(listener);
      };
    },

    off: (type: string, listener?: BridgeMessageListener) => {
      if (listener) {
        const typeListeners = listeners.get(type);
        if (typeListeners) {
          typeListeners.delete(listener);
          if (typeListeners.size === 0) {
            listeners.delete(type);
          }
        }
      } else {
        listeners.delete(type);
      }
    },
  };
})();
