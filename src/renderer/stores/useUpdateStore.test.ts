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
  readyState,
} = vi.hoisted(() => {
  const progressListeners: Array<(event: UpdateProgressEvent) => void> = [];
  const unsubscribeMock = vi.fn();
  // 실제 subscribe()는 listen 등록 완료를 알리는 ready를 함께 돌려준다
  const readyState = { promise: Promise.resolve() };
  return {
    progressListeners,
    unsubscribeMock,
    readyState,
    autoUpdateMock: vi.fn(),
    restartMock: vi.fn(),
    onUpdateProgressMock: vi.fn(
      (listener: (event: UpdateProgressEvent) => void) => {
        progressListeners.push(listener);
        return Object.assign(unsubscribeMock, { ready: readyState.promise });
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
    readyState.promise = Promise.resolve();
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
    // 구독 준비를 기다린 뒤에야 다운로드가 시작된다
    await vi.waitFor(() => expect(autoUpdateMock).toHaveBeenCalledTimes(1));

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

    // 재시작 요청은 이미 백엔드에 넘어갔다. 모달만 닫혀 watchdog을 잃으면 안 된다
    useUpdateStore.getState().dismissUpdate();
    expect(useUpdateStore.getState().isAutoUpdating).toBe(true);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('restarting');
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

  it('누르는 즉시 다운로드 0%에서 출발한다', () => {
    autoUpdateMock.mockImplementation(() => new Promise<void>(() => {}));

    void useUpdateStore.getState().runAutoUpdate('1.6.2');

    // 첫 진행 이벤트를 기다리지 않는다 - 라벨이 두 번 바뀌지 않게
    const state = useUpdateStore.getState();
    expect(state.autoUpdatePhase).toBe('downloading');
    expect(state.autoUpdateProgress).toBe(0);
  });

  it('크기를 모르는 다운로드는 진행률 없음을 그대로 남긴다', () => {
    autoUpdateMock.mockImplementation(() => new Promise<void>(() => {}));

    void useUpdateStore.getState().runAutoUpdate('1.6.2');
    expect(useUpdateStore.getState().autoUpdateProgress).toBe(0);

    // 직전 값으로 메우면 눌렀을 때 심어둔 0이 끝까지 남아 멈춘 화면이 된다
    emitProgress({ phase: 'downloading', percent: null });
    expect(useUpdateStore.getState().autoUpdateProgress).toBeNull();
  });

  it('진행 이벤트 구독이 준비된 뒤에 다운로드를 시작한다', async () => {
    let markReady: () => void = () => {};
    readyState.promise = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    autoUpdateMock.mockResolvedValue(undefined);
    restartMock.mockImplementation(() => new Promise<void>(() => {}));

    void useUpdateStore.getState().runAutoUpdate('1.6.2');
    await Promise.resolve();
    expect(autoUpdateMock).not.toHaveBeenCalled();

    markReady();
    await vi.waitFor(() => expect(autoUpdateMock).toHaveBeenCalledTimes(1));
  });

  it('재시작만 실패한 상태에서 다시 요청하면 설치를 반복하지 않는다', async () => {
    autoUpdateMock.mockResolvedValue({
      previousVersion: '1.6.1',
      updatedTo: '1.6.2',
      downloadUrl: 'x',
    });
    restartMock.mockRejectedValueOnce(new Error('flush cancelled'));

    await expect(
      useUpdateStore.getState().runAutoUpdate('1.6.2'),
    ).rejects.toBeInstanceOf(UpdateInstalledRestartFailedError);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('installed');

    autoUpdateMock.mockClear();
    restartMock.mockClear();
    restartMock.mockResolvedValue(undefined);

    await useUpdateStore.getState().retryRestart();

    // 설치는 이미 끝났다 - 재시작만 다시 요청한다
    expect(autoUpdateMock).not.toHaveBeenCalled();
    expect(restartMock).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('restarting');
  });

  it('재시도가 또 실패하면 재실행 상태로 되돌린다', async () => {
    useUpdateStore.setState({
      isAutoUpdating: true,
      autoUpdatePhase: 'installed',
    });
    restartMock.mockRejectedValue(new Error('flush cancelled'));

    await expect(
      useUpdateStore.getState().retryRestart(),
    ).rejects.toBeInstanceOf(UpdateInstalledRestartFailedError);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('installed');
  });

  it('설치 완료 상태가 아니면 재시작 재시도를 무시한다', async () => {
    await useUpdateStore.getState().retryRestart();
    expect(restartMock).not.toHaveBeenCalled();
  });

  it('다운로드 중에는 닫기를 무시한다', async () => {
    autoUpdateMock.mockImplementation(() => new Promise<void>(() => {}));

    void useUpdateStore.getState().runAutoUpdate('1.6.2');
    await vi.waitFor(() => expect(autoUpdateMock).toHaveBeenCalledTimes(1));
    emitProgress({ phase: 'downloading', percent: 30 });

    useUpdateStore.getState().dismissUpdate();

    // 중단할 방법이 없는 구간이다. 닫히면 재진입 가드가 풀려 설치가 두 번 돈다
    const state = useUpdateStore.getState();
    expect(state.isAutoUpdating).toBe(true);
    expect(state.autoUpdatePhase).toBe('downloading');
    expect(state.autoUpdateProgress).toBe(30);

    await useUpdateStore.getState().runAutoUpdate('1.6.2');
    expect(autoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('재시작 대기 중에는 닫기를 무시한다', () => {
    useUpdateStore.setState({
      isAutoUpdating: true,
      autoUpdatePhase: 'restarting',
      updateAvailable: true,
    });

    useUpdateStore.getState().dismissUpdate();

    expect(useUpdateStore.getState().isAutoUpdating).toBe(true);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('restarting');
    expect(useUpdateStore.getState().updateAvailable).toBe(true);
  });

  it('재실행 상태에서는 닫을 수 있다', () => {
    useUpdateStore.setState({
      isAutoUpdating: true,
      autoUpdatePhase: 'installed',
      updateAvailable: true,
    });

    useUpdateStore.getState().dismissUpdate();

    expect(useUpdateStore.getState().isAutoUpdating).toBe(false);
    expect(useUpdateStore.getState().autoUpdatePhase).toBe('idle');
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
