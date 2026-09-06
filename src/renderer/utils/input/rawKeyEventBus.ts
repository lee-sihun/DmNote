/**
 * Raw Key Event Bus
 * 백엔드에서 raw input 이벤트를 구독 기반으로 수신
 * 구독자가 있을 때만 백엔드가 이벤트를 emit하도록 최적화
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type RawInputPayload = {
  device: 'keyboard' | 'mouse' | 'gamepad' | 'unknown';
  label: string;
  labels: string[];
  state: string;
};

export type RawKeyEventListener = (payload: RawInputPayload) => void;

class RawKeyEventBus {
  private listeners: Set<RawKeyEventListener> = new Set();
  private initialized = false;
  private unlistenFn: (() => void) | null = null;

  /**
   * 백엔드 raw input 이벤트 구독 초기화
   * 첫 번째 리스너가 등록될 때 자동으로 호출됨
   */
  private async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // 백엔드 이벤트 리스너 등록
      const unlisten = await listen<RawInputPayload>(
        'input:raw',
        ({ payload }) => {
          // 모든 리스너에게 브로드캐스트
          this.listeners.forEach((listener) => {
            try {
              listener(payload);
            } catch (error) {
              console.error('[RawKeyEventBus] Listener error:', error);
            }
          });
        },
      );

      this.unlistenFn = unlisten;
    } catch (error) {
      console.error('[RawKeyEventBus] Failed to initialize:', error);
      this.initialized = false;
    }
  }

  /**
   * Raw key 이벤트 리스너 등록
   * 첫 번째 구독자일 경우 백엔드에 구독 시작 알림
   */
  async subscribe(listener: RawKeyEventListener): Promise<() => void> {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);

    // 첫 번째 구독자면 백엔드에 알림 및 초기화
    if (wasEmpty) {
      await this.initialize();
      try {
        await invoke('raw_input_subscribe');
      } catch (error) {
        console.error(
          '[RawKeyEventBus] Failed to subscribe to backend:',
          error,
        );
      }
    }

    // unsubscribe 함수 반환
    return () => {
      this.unsubscribe(listener);
    };
  }

  /**
   * 리스너 제거
   * 마지막 구독자면 백엔드에 구독 중지 알림
   */
  private async unsubscribe(listener: RawKeyEventListener) {
    this.listeners.delete(listener);

    // 마지막 구독자가 제거되면 백엔드에 알림
    if (this.listeners.size === 0) {
      try {
        await invoke('raw_input_unsubscribe');
      } catch (error) {
        console.error(
          '[RawKeyEventBus] Failed to unsubscribe from backend:',
          error,
        );
      }
    }
  }

  /**
   * 등록된 리스너 수 (디버깅용)
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * 모든 리스너 제거 및 정리
   */
  async dispose() {
    const hadListeners = this.listeners.size > 0;
    this.listeners.clear();

    if (hadListeners) {
      try {
        await invoke('raw_input_unsubscribe');
      } catch {
        // 무시 - 앱 종료 시 발생할 수 있음
      }
    }

    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }

    this.initialized = false;
  }
}

// 싱글톤 인스턴스
export const rawKeyEventBus = new RawKeyEventBus();
