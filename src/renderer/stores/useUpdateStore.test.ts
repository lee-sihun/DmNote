import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateProgressEvent } from '@src/types/plugin/api';

// 스토어가 모듈 평가 시점에 읽는 Vite define — vitest에는 없으므로 먼저 정의
vi.hoisted(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = '1.6.1';
});

const {
  autoUpdateMock,
  restartMock,
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
    restartMock: vi.fn(),
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
    restart: restartMock,
    onUpdateProgress: onUpdateProgressMock,
  },
}));

import {
  UpdateInstalledRestartFailedError,
  useUpdateStore,
} from '@stores/useUpdateStore';

const emitProgress = (event: UpdateProgressEvent) => {
  progressListeners.forEach((listener) => listener(event));
};

describe('useUpdateStore.runAutoUpdate', () => {
  beforeEach(() => {
    localStorage.clear();
    progressListeners.length = 0;
    autoUpdateMock.mockReset();
    restartMock.mockReset();
    restartMock.mockResolvedValue(undefined);
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
    // 재시작 대기 중에는 재클릭을 막기 위해 진행 중 상태 유지
    expect(state.isAutoUpdating).toBe(true);
    expect(state.autoUpdatePhase).toBe('restarting');
    expect(state.error).toBeNull();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(restartMock).toHaveBeenCalledTimes(1);

    // 구독 해제 전에 도착한 늦은 이벤트는 무시
    emitProgress({ phase: 'installing', percent: null });
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('restarting');

    // 재시작이 취소돼 모달을 닫으면 다시 시도 가능 상태로
    useUpdateStore.getState().dismissUpdate();
    expect(useUpdateStore.getState().isAutoUpdating).toBe(false);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('idle');
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

  it('설치는 됐지만 재시작 요청이 실패하면 전용 오류로 구분하고 릴리즈 노트 예약은 유지', async () => {
    autoUpdateMock.mockResolvedValue({
      previousVersion: '1.6.1',
      updatedTo: '1.6.2',
      downloadUrl: 'x',
    });
    let phaseAtRestart: string | null = null;
    restartMock.mockImplementation(async () => {
      phaseAtRestart = useUpdateStore.getState().autoUpdatePhase;
      throw new Error('flush cancelled');
    });

    await expect(
      useUpdateStore.getState().runAutoUpdate('1.6.2'),
    ).rejects.toBeInstanceOf(UpdateInstalledRestartFailedError);

    // 재시작 요청 시점엔 restarting, 실패 후엔 installed 종단 상태 (버튼 비활성 유지)
    expect(phaseAtRestart).toBe('restarting');
    const state = useUpdateStore.getState();
    expect(state.isAutoUpdating).toBe(true);
    expect(state.autoUpdatePhase).toBe('installed');
    expect(state.error).toBeNull();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(
      localStorage.getItem('dmnote:post-update-release-notice-version'),
    ).toBe('1.6.2');
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
