/**
 * HID 축(노브) 이벤트 버스
 * 백엔드 input:axis(절대 raw 값)를 한 번만 구독하고,
 * 축별 wrap 델타를 계산해 axisSignals에 누적(중앙 집중 — 1회만).
 * 추가 구독자(매핑 UI 등)는 raw 페이로드를 그대로 받음.
 */

import { listen } from '@tauri-apps/api/event';
import { addAxisDelta } from '@stores/signals/axisSignals';

export type AxisPayload = {
  axisId: string;
  value: number;
  full: number;
};

export type AxisEventListener = (payload: AxisPayload) => void;

class AxisEventBus {
  private listeners: Set<AxisEventListener> = new Set();
  private initialized = false;
  private unlistenFn: (() => void) | null = null;
  private lastValue: Map<string, number> = new Map();

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      this.unlistenFn = await listen<AxisPayload>('input:axis', ({ payload }) =>
        this.handle(payload),
      );
    } catch (error) {
      console.error('[AxisEventBus] Failed to initialize:', error);
      this.initialized = false;
    }
  }

  private handle(payload: AxisPayload) {
    const { axisId, value, full } = payload;

    // wrap 최단경로 델타: 절대값 순환을 부호 델타로 환산해 누적
    if (full > 0) {
      const last = this.lastValue.get(axisId);
      if (last !== undefined) {
        const half = full / 2;
        const delta = ((((value - last + half) % full) + full) % full) - half;
        addAxisDelta(axisId, delta);
      }
      this.lastValue.set(axisId, value);
    }

    // 추가 구독자(매핑 UI 등)에 raw 페이로드 전달
    this.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error('[AxisEventBus] Listener error:', error);
      }
    });
  }

  /** raw 축 페이로드 구독 (매핑 UI의 축 캡처용) */
  subscribe(listener: AxisEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getListenerCount(): number {
    return this.listeners.size;
  }
}

export const axisEventBus = new AxisEventBus();
