/**
 * keyStatsService 유휴 통지 dedupe 회귀 테스트
 * 50ms 주기 틱이 값 미변경 시 리스너 fan-out을 만들지 않아야 함
 */
import { describe, it, expect, vi } from 'vitest';

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(() =>
    Promise.resolve({ keyCounters: {}, currentMode: '4key' }),
  ),
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

import { keyStatsService } from '@utils/keyStatsService';

type ServicePrivate = {
  updateStats: () => void;
  timestamps: number[];
};

describe('keyStatsService 유휴 통지 dedupe', () => {
  it('값이 변하지 않으면 주기 틱이 리스너를 호출하지 않는다', () => {
    const listener = vi.fn();
    const unsubscribe = keyStatsService.subscribe(listener);
    const svc = keyStatsService as unknown as ServicePrivate;

    // 구독 즉시 1회 + 첫 틱(lastNotified 초기화) 허용
    svc.updateStats();
    listener.mockClear();

    // 유휴 200틱 (수정 전: 200회 통지)
    for (let i = 0; i < 200; i += 1) svc.updateStats();
    expect(listener).toHaveBeenCalledTimes(0);

    // 키 입력 발생 → 통지 재개
    svc.timestamps.push(Date.now());
    svc.updateStats();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
