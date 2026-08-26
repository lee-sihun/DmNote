/**
 * 키 통계 서비스
 * KPS(Keys Per Second) 및 키 입력 통계를 계산하고 구독 기반으로 제공
 * 현재 탭에 할당된 키들에 대한 통계만 계산
 * 구독자가 있을 때만 계산하여 성능 최적화
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { KeyStatsPayload } from '@src/types/plugin/api';
import type { KeyCounters } from '@src/types/key/keys';

export type KeyStatsListener = (stats: KeyStatsPayload) => void;

// 통계 업데이트 주기 (ms)
const STATS_UPDATE_INTERVAL = 50;

class KeyStatsService {
  private listeners: Set<KeyStatsListener> = new Set();
  private initialized = false;
  private unlistenInputPress: (() => void) | null = null;
  private unlistenCounterChanged: (() => void) | null = null;
  private unlistenCountersChanged: (() => void) | null = null;
  private unlistenModeChanged: (() => void) | null = null;
  private unlistenPresetSnapshot: (() => void) | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  // KPS 계산용 타임스탬프 배열 (최근 1초)
  private timestamps: number[] = [];

  // KPS 통계
  private kpsMax = 0;
  private kpsSum = 0;
  private kpsCount = 0;

  // 현재 탭의 키 카운터 합계
  private total = 0;
  private currentMode = '';
  private keyCounters: KeyCounters = {};

  // 마지막 통지 스냅샷 — 유휴 틱의 동일 값 재통지 방지
  private lastNotified: KeyStatsPayload | null = null;

  /**
   * 초기화: 이벤트 리스너 등록
   */
  private async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // 물리 press 이벤트 구독 (KPS 집계, 계약 §6)
      // 한 물리 입력이 여러 슬롯을 트리거해도 1회만 발행됨
      this.unlistenInputPress = await listen<{ label: string; mode: string }>(
        'input:press',
        () => {
          this.timestamps.push(Date.now());
        },
      );

      // 개별 키 카운터 변경 이벤트 구독
      this.unlistenCounterChanged = await listen<{
        mode: string;
        key: string;
        count: number;
      }>('keys:counter', ({ payload }) => {
        this.handleCounterChanged(payload);
      });

      // 전체 카운터 변경 이벤트 구독 (resetCounters 등)
      this.unlistenCountersChanged = await listen<KeyCounters>(
        'keys:counters',
        ({ payload }) => {
          this.keyCounters = payload;
          this.updateTotal();
        },
      );

      // 모드 변경 이벤트 구독
      this.unlistenModeChanged = await listen<{ mode: string }>(
        'keys:mode-changed',
        ({ payload }) => {
          this.currentMode = payload.mode;
          this.updateTotal();
        },
      );

      // 프리셋 로드 시 모드 동기화
      this.unlistenPresetSnapshot = await listen<{ selectedKeyType: string }>(
        'preset:snapshot',
        ({ payload }) => {
          this.currentMode = payload.selectedKeyType;
          this.updateTotal();
        },
      );

      // 초기 카운터 및 모드 로드
      await this.loadInitialState();

      // 주기적 통계 업데이트 시작
      this.updateInterval = setInterval(() => {
        this.updateStats();
      }, STATS_UPDATE_INTERVAL);
    } catch (error) {
      console.error('[KeyStatsService] Failed to initialize:', error);
      this.initialized = false;
    }
  }

  /**
   * 초기 상태 로드
   */
  private async loadInitialState() {
    try {
      const bootstrap = await invoke<{
        key_counters?: KeyCounters;
        keyCounters?: KeyCounters;
        current_mode?: string;
        currentMode?: string;
        selected_key_type?: string;
        selectedKeyType?: string;
      }>('app_bootstrap');

      this.keyCounters = bootstrap.key_counters || bootstrap.keyCounters || {};
      this.currentMode =
        bootstrap.current_mode ||
        bootstrap.currentMode ||
        bootstrap.selected_key_type ||
        bootstrap.selectedKeyType ||
        '4key';
      this.updateTotal();
    } catch (error) {
      console.error('[KeyStatsService] Failed to load initial state:', error);
    }
  }

  /**
   * 개별 카운터 변경 핸들러
   */
  private handleCounterChanged(payload: {
    mode: string;
    key: string;
    count: number;
  }) {
    const { mode, key, count } = payload;

    if (!this.keyCounters[mode]) {
      this.keyCounters[mode] = {};
    }
    this.keyCounters[mode][key] = count;

    // 현재 모드라면 total 업데이트 및 즉시 리스너에게 알림
    if (mode === this.currentMode) {
      this.updateTotal();
      this.notifyListeners();
    }
  }

  /**
   * total 값 업데이트 (현재 모드의 모든 키 카운트 합산)
   */
  private updateTotal() {
    const modeCounters = this.keyCounters[this.currentMode];
    if (modeCounters) {
      this.total = Object.values(modeCounters).reduce<number>(
        (sum, count) => sum + count,
        0,
      );
    } else {
      this.total = 0;
    }
  }

  /**
   * 현재 통계 스냅샷 생성
   */
  private getCurrentStats(): KeyStatsPayload {
    const now = Date.now();

    // 1초 이전 타임스탬프 제거
    while (this.timestamps.length > 0 && this.timestamps[0] < now - 1000) {
      this.timestamps.shift();
    }

    const kps = this.timestamps.length;
    const kpsAvg =
      this.kpsCount > 0 ? Math.round(this.kpsSum / this.kpsCount) : 0;

    return {
      kps,
      kpsAvg,
      kpsMax: this.kpsMax,
      total: this.total,
    };
  }

  /**
   * 모든 리스너에게 현재 통계 전달
   */
  private notifyListeners() {
    if (this.listeners.size === 0) return;

    const stats = this.getCurrentStats();

    // 값이 전부 그대로면 통지 생략 (신규 구독자는 subscribe에서 즉시 1회 수신)
    const last = this.lastNotified;
    if (
      last &&
      last.kps === stats.kps &&
      last.kpsAvg === stats.kpsAvg &&
      last.kpsMax === stats.kpsMax &&
      last.total === stats.total
    ) {
      return;
    }
    this.lastNotified = stats;

    this.listeners.forEach((listener) => {
      try {
        listener(stats);
      } catch (error) {
        console.error('[KeyStatsService] Listener error:', error);
      }
    });
  }

  /**
   * 주기적 통계 업데이트 (KPS 계산 포함)
   */
  private updateStats() {
    if (this.listeners.size === 0) return;

    const now = Date.now();

    // 1초 이전 타임스탬프 제거
    while (this.timestamps.length > 0 && this.timestamps[0] < now - 1000) {
      this.timestamps.shift();
    }

    const kps = this.timestamps.length;

    // 최대 KPS 업데이트
    if (kps > this.kpsMax) {
      this.kpsMax = kps;
    }

    // 평균 KPS 계산 (kps > 0일 때만 카운트)
    if (kps > 0) {
      this.kpsSum += kps;
      this.kpsCount++;
    }

    // 리스너에게 전달
    this.notifyListeners();
  }

  /**
   * 통계 구독 (동기 - unsubscribe 함수 즉시 반환)
   * @returns 구독 해제 함수
   */
  subscribe(listener: KeyStatsListener): () => void {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);

    // 첫 번째 구독자면 초기화 (백그라운드)
    if (wasEmpty) {
      this.initialize().catch((error) => {
        console.error('[KeyStatsService] Initialize failed:', error);
      });
    }

    // 즉시 현재 통계 전달
    listener(this.getCurrentStats());

    // 동기적으로 unsubscribe 함수 반환
    return () => {
      this.unsubscribe(listener);
    };
  }

  /**
   * 구독 해제
   */
  private unsubscribe(listener: KeyStatsListener) {
    this.listeners.delete(listener);

    // 마지막 구독자가 제거되면 정리 (백그라운드)
    if (this.listeners.size === 0) {
      this.cleanup().catch((error) => {
        console.error('[KeyStatsService] Cleanup failed:', error);
      });
    }
  }

  /**
   * 통계 초기화 (리셋)
   */
  reset() {
    this.timestamps = [];
    this.kpsMax = 0;
    this.kpsSum = 0;
    this.kpsCount = 0;
    this.lastNotified = null;
    // total은 카운터에서 계산되므로 리셋하지 않음
  }

  /**
   * 현재 통계 조회 (일회성)
   */
  getStats(): KeyStatsPayload {
    return this.getCurrentStats();
  }

  /**
   * 리소스 정리
   */
  private async cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.unlistenInputPress) {
      this.unlistenInputPress();
      this.unlistenInputPress = null;
    }

    if (this.unlistenCounterChanged) {
      this.unlistenCounterChanged();
      this.unlistenCounterChanged = null;
    }

    if (this.unlistenCountersChanged) {
      this.unlistenCountersChanged();
      this.unlistenCountersChanged = null;
    }

    if (this.unlistenModeChanged) {
      this.unlistenModeChanged();
      this.unlistenModeChanged = null;
    }

    if (this.unlistenPresetSnapshot) {
      this.unlistenPresetSnapshot();
      this.unlistenPresetSnapshot = null;
    }

    this.initialized = false;
    this.reset();
  }

  /**
   * 완전 정리 (앱 종료 시)
   */
  async dispose() {
    this.listeners.clear();
    await this.cleanup();
  }

  /**
   * 구독자 수 (디버깅용)
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

// 싱글톤 인스턴스
export const keyStatsService = new KeyStatsService();
