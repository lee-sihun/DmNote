import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateProgressEvent } from '@src/types/plugin/api';

// 스토어가 모듈 평가 시점에 읽는 Vite define — vitest에는 없으므로 먼저 정의
vi.hoisted(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = '1.6.1';
});

const {
  autoUpdateMock,
  onUpdateProgressMock,
  unsubscribeMock,
  progressListeners,
} = vi.hoisted(() => {
  const progressListeners: Array<(event: UpdateProgressEvent) => void> = [];
  const unsubscribeMock = vi.fn();
  return {
    progressListeners,
    unsubscribeMock,
    autoUpdateMock: vi.fn(),
    onUpdateProgressMock: vi.fn(
      (listener: (event: UpdateProgressEvent) => void) => {
        progressListeners.push(listener);
        return unsubscribeMock;
      },
    ),
  };
});

vi.mock('@api/modules/appApi', () => ({
  appApi: {
    autoUpdate: autoUpdateMock,
    onUpdateProgress: onUpdateProgressMock,
  },
}));

import { useUpdateStore } from '@stores/useUpdateStore';

const emitProgress = (event: UpdateProgressEvent) => {
  progressListeners.forEach((listener) => listener(event));
};

describe('useUpdateStore.runAutoUpdate', () => {
  beforeEach(() => {
    localStorage.clear();
    progressListeners.length = 0;
    autoUpdateMock.mockReset();
    onUpdateProgressMock.mockClear();
    unsubscribeMock.mockClear();
    useUpdateStore.setState({
      isAutoUpdating: false,
      autoUpdatePhase: 'idle',
      autoUpdateProgress: null,
      error: null,
    });
  });

  it('진행 이벤트를 단계/진행률로 반영하고 성공 시 restarting으로 끝난다', async () => {
    let resolveUpdate: () => void = () => {};
    autoUpdateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const run = useUpdateStore.getState().runAutoUpdate('1.6.2');
    await Promise.resolve();
    expect(useUpdateStore.getState().isAutoUpdating).toBe(true);
    expect(onUpdateProgressMock).toHaveBeenCalledTimes(1);

    emitProgress({ phase: 'downloading', percent: 0 });
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('downloading');
    expect(useUpdateStore.getState().autoUpdateProgress).toBe(0);

    emitProgress({ phase: 'downloading', percent: 73 });
    expect(useUpdateStore.getState().autoUpdateProgress).toBe(73);

    emitProgress({ phase: 'verifying', percent: null });
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('verifying');
    expect(useUpdateStore.getState().autoUpdateProgress).toBeNull();

    emitProgress({ phase: 'installing', percent: null });
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('installing');

    resolveUpdate();
    await run;

    const state = useUpdateStore.getState();
    expect(state.isAutoUpdating).toBe(false);
    expect(state.autoUpdatePhase).toBe('restarting');
    expect(state.error).toBeNull();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(
      localStorage.getItem('dmnote:post-update-release-notice-version'),
    ).toBe('1.6.2');
  });

  it('실패 시 idle로 복귀하고 오류·구독 해제·릴리즈 노트 예약 취소', async () => {
    autoUpdateMock.mockRejectedValue(new Error('signing team mismatch'));

    await expect(
      useUpdateStore.getState().runAutoUpdate('1.6.2'),
    ).rejects.toThrow('signing team mismatch');

    const state = useUpdateStore.getState();
    expect(state.isAutoUpdating).toBe(false);
    expect(state.autoUpdatePhase).toBe('idle');
    expect(state.autoUpdateProgress).toBeNull();
    expect(state.error).toBe('signing team mismatch');
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(
      localStorage.getItem('dmnote:post-update-release-notice-version'),
    ).toBeNull();
  });

  it('진행 중 재진입은 무시한다', async () => {
    autoUpdateMock.mockImplementation(() => new Promise<void>(() => {}));

    void useUpdateStore.getState().runAutoUpdate('1.6.2');
    await Promise.resolve();
    await useUpdateStore.getState().runAutoUpdate('1.6.2');

    expect(autoUpdateMock).toHaveBeenCalledTimes(1);
    expect(onUpdateProgressMock).toHaveBeenCalledTimes(1);
  });

  it('빈 태그는 거부한다', async () => {
    await expect(useUpdateStore.getState().runAutoUpdate('  ')).rejects.toThrow(
      'Invalid target version',
    );
    expect(autoUpdateMock).not.toHaveBeenCalled();
  });
});
