import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  composePreviewPositions,
  previewOverlay,
} from '@src/renderer/editor/runtime/previewOverlay';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { previewApi } from '@api/modules/previewApi';

import type { KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { PreviewEnvelope } from '@src/types/preview';

const { commitPatchMock } = vi.hoisted(() => ({
  commitPatchMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    subscribe: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    commitPatch: commitPatchMock,
    getState: () => ({ revision: null }),
  },
}));

const basePosition = (dx: number) => ({
  dx,
  dy: 0,
  width: 60,
  height: 60,
  activeImage: '',
  inactiveImage: '',
});

const canonicalFixture = (): KeyPositions =>
  ({
    '4key': [basePosition(0), basePosition(70)],
  } as unknown as KeyPositions);

const statFixture = (): StatItemPositions =>
  ({
    '4key': [{ ...basePosition(0), statType: 'kps' }],
  } as unknown as StatItemPositions);

const graphFixture = (): GraphItemPositions =>
  ({
    '4key': [
      {
        ...basePosition(0),
        statType: 'kps',
        graphType: 'line',
        graphSpeed: 1,
        graphColor: '#ffffff',
      },
    ],
  } as unknown as GraphItemPositions);

const knobFixture = (): KnobItemPositions =>
  ({
    '4key': [
      {
        ...basePosition(0),
        axisId: 'HIDA:test',
        sensitivity: 1,
        reverse: false,
      },
    ],
  } as unknown as KnobItemPositions);

const resetPositionStores = () => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    canonicalPositions: canonicalFixture(),
    positions: canonicalFixture(),
  });
  useStatItemStore.setState({ positions: statFixture() });
  useGraphItemStore.setState({ positions: graphFixture() });
  useKnobItemStore.setState({ positions: knobFixture() });
};

const remoteEnvelope = (
  overrides: Partial<PreviewEnvelope>,
): PreviewEnvelope => ({
  schemaVersion: 1,
  sessionId: 'remote-session',
  seq: 1,
  kind: 'patch',
  sourceLabel: 'panel',
  domain: 'keyPosition',
  mode: '4key',
  targets: [0],
  patch: { backgroundColor: '#ff0000' },
  ...overrides,
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('previewOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewOverlay.clearAll();
    resetPositionStores();
  });

  afterEach(() => {
    editGestureController.cancel();
    previewOverlay.clearAll();
  });

  it('로컬 patch는 rendered에만 합성되고 canonical은 불변', () => {
    previewOverlay.applyLocalPatch('s1', '4key', [0], {
      backgroundColor: '#123456',
    });

    const state = useKeyStore.getState();
    expect(state.positions['4key'][0].backgroundColor).toBe('#123456');
    expect(state.canonicalPositions['4key'][0].backgroundColor).toBeUndefined();
    expect(state.positions['4key'][1]).toEqual(
      state.canonicalPositions['4key'][1],
    );
  });

  it('세션 종료 시 오버레이만 제거되고 rendered가 canonical로 복귀', () => {
    previewOverlay.applyLocalPatch('s1', '4key', [0], { width: 120 });
    previewOverlay.endSession('s1');

    const state = useKeyStore.getState();
    expect(state.positions['4key'][0].width).toBe(60);
    expect(state.canonicalPositions['4key'][0].width).toBe(60);
  });

  it('원격 envelope는 세션 내 stale seq를 폐기', () => {
    previewOverlay.applyRemoteEnvelope(remoteEnvelope({ seq: 2 }));
    previewOverlay.applyRemoteEnvelope(
      remoteEnvelope({ seq: 1, patch: { backgroundColor: '#00ff00' } }),
    );

    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#ff0000',
    );
  });

  it('종료된 세션의 늦은 patch는 tombstone으로 차단', () => {
    previewOverlay.applyRemoteEnvelope(remoteEnvelope({ seq: 1 }));
    previewOverlay.endSession('remote-session');
    previewOverlay.applyRemoteEnvelope(remoteEnvelope({ seq: 2 }));

    expect(
      useKeyStore.getState().positions['4key'][0].backgroundColor,
    ).toBeUndefined();
  });

  it('cancel envelope는 세션 오버레이를 제거', () => {
    previewOverlay.applyRemoteEnvelope(remoteEnvelope({ seq: 1 }));
    previewOverlay.applyRemoteEnvelope(
      remoteEnvelope({ seq: 2, kind: 'cancel', targets: [], patch: {} }),
    );

    expect(
      useKeyStore.getState().positions['4key'][0].backgroundColor,
    ).toBeUndefined();
  });

  it('병합 커밋은 두 창의 세션을 함께 끝내고 늦은 patch를 차단', () => {
    previewOverlay.applyLocalPatch('main-session', '4key', [0], { width: 90 });
    previewOverlay.applyRemoteEnvelope(
      remoteEnvelope({
        sessionId: 'panel-session',
        targets: [1],
        patch: { width: 95 },
      }),
    );

    previewOverlay.endSessions(['main-session', 'panel-session']);

    expect(useKeyStore.getState().positions['4key'][0].width).toBe(60);
    expect(useKeyStore.getState().positions['4key'][1].width).toBe(60);

    previewOverlay.applyLocalPatch('main-session', '4key', [0], { width: 100 });
    previewOverlay.applyRemoteEnvelope(
      remoteEnvelope({
        sessionId: 'panel-session',
        seq: 2,
        targets: [1],
        patch: { width: 105 },
      }),
    );
    expect(useKeyStore.getState().positions['4key'][0].width).toBe(60);
    expect(useKeyStore.getState().positions['4key'][1].width).toBe(60);
  });

  it('프리뷰 활성 중 canonical 편집이 들어와도 오버레이가 재합성됨', () => {
    previewOverlay.applyLocalPatch('s1', '4key', [0], {
      backgroundColor: '#123456',
    });

    const next = canonicalFixture();
    next['4key'][1] = { ...next['4key'][1], width: 200 };
    useKeyStore.getState().setPositions(next);

    const state = useKeyStore.getState();
    expect(state.positions['4key'][0].backgroundColor).toBe('#123456');
    expect(state.positions['4key'][1].width).toBe(200);
    expect(state.canonicalPositions['4key'][0].backgroundColor).toBeUndefined();
  });

  it('stat patch는 canonical을 바꾸지 않고 도메인 렌더 결과에만 합성', () => {
    previewOverlay.applyLocalPatch(
      'stat-session',
      '4key',
      [0],
      { width: 120 },
      'statPosition',
    );

    const canonical = useStatItemStore.getState().positions;
    const rendered = composePreviewPositions('statPosition', canonical);
    expect(canonical['4key'][0].width).toBe(60);
    expect(rendered['4key'][0].width).toBe(120);

    previewOverlay.endSession('stat-session');
    expect(
      composePreviewPositions('statPosition', canonical)['4key'][0].width,
    ).toBe(60);
  });

  it('같은 세션과 index의 서로 다른 도메인 patch를 독립 보관', () => {
    previewOverlay.applyLocalPatch('mixed-session', '4key', [0], {
      width: 90,
    });
    previewOverlay.applyLocalPatch(
      'mixed-session',
      '4key',
      [0],
      { width: 130 },
      'statPosition',
    );

    expect(useKeyStore.getState().positions['4key'][0].width).toBe(90);
    expect(
      composePreviewPositions(
        'statPosition',
        useStatItemStore.getState().positions,
      )['4key'][0].width,
    ).toBe(130);
  });
});

describe('editGestureController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editGestureController.cancel();
    previewOverlay.clearAll();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    resetPositionStores();
  });

  afterEach(() => {
    editGestureController.cancel();
    previewOverlay.clearAll();
    vi.unstubAllGlobals();
  });

  it('첫 preview에서 게스처 시작', () => {
    editGestureController.preview('4key', [
      { index: 0, patch: { backgroundColor: '#abcdef' } },
    ]);

    expect(editGestureController.hasActiveGesture()).toBe(true);
    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#abcdef',
    );
  });

  it('preview는 coalescing 후 채널로 발행됨', async () => {
    editGestureController.preview('4key', [
      { index: 0, patch: { backgroundColor: '#111111' } },
    ]);
    await flushPromises();

    expect(previewApi.publish).toHaveBeenCalledTimes(1);
    const request = vi.mocked(previewApi.publish).mock.calls[0][0];
    expect(request.mode).toBe('4key');
    expect(request.domain).toBe('keyPosition');
    expect(request.targets).toEqual([0]);
    expect(request.patch).toEqual({ backgroundColor: '#111111' });
  });

  it('발행 대기 중 쌓인 중간값은 대상별 최신 값 하나로 합쳐 발행됨', async () => {
    let release: () => void = () => undefined;
    vi.mocked(previewApi.publish).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    editGestureController.preview('4key', [{ index: 0, patch: { width: 1 } }]);
    await flushPromises();
    expect(previewApi.publish).toHaveBeenCalledTimes(1);

    // in-flight 하나가 도는 동안 값이 계속 바뀐다 (드래그, 방향키 꾹 누르기)
    for (const width of [2, 3, 4, 5]) {
      editGestureController.preview('4key', [{ index: 0, patch: { width } }]);
      await flushPromises();
    }
    expect(previewApi.publish).toHaveBeenCalledTimes(1);

    release();
    await flushPromises();
    await flushPromises();

    // 중간값 2, 3, 4는 이미 무의미하므로 IPC를 타지 않는다
    expect(previewApi.publish).toHaveBeenCalledTimes(2);
    expect(vi.mocked(previewApi.publish).mock.calls[1][0].patch).toEqual({
      width: 5,
    });
  });

  it('아직 발행하지 않은 다른 그룹은 대기 중 최신값으로 교체됨', async () => {
    let release: () => void = () => undefined;
    vi.mocked(previewApi.publish).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    editGestureController.preview('4key', [
      { index: 0, patch: { width: 10 } },
      { index: 1, patch: { width: 20 } },
    ]);
    await flushPromises();
    expect(previewApi.publish).toHaveBeenCalledTimes(1);

    editGestureController.preview('4key', [{ index: 1, patch: { width: 30 } }]);
    await flushPromises();

    release();
    await flushPromises();
    await flushPromises();

    const targetOneCalls = vi
      .mocked(previewApi.publish)
      .mock.calls.map(([request]) => request)
      .filter((request) => request.targets.includes(1));
    expect(targetOneCalls).toHaveLength(1);
    expect(targetOneCalls[0].patch).toEqual({ width: 30 });
  });

  it('같은 patch를 쓰는 여러 대상은 한 번에 발행됨', async () => {
    editGestureController.preview('4key', [
      { index: 0, patch: { width: 42 } },
      { index: 1, patch: { width: 42 } },
    ]);
    await flushPromises();

    expect(previewApi.publish).toHaveBeenCalledTimes(1);
    const request = vi.mocked(previewApi.publish).mock.calls[0][0];
    expect(request.targets).toEqual([0, 1]);
    expect(request.patch).toEqual({ width: 42 });
  });

  it('settleCommit 성공 시 로컬 세션 종료 + 보조 cancel 브로드캐스트', async () => {
    editGestureController.preview('4key', [
      { index: 0, patch: { width: 100 } },
    ]);
    const sessionId = editGestureController.activeGestureId();

    editGestureController.settleCommit(Promise.resolve());
    await flushPromises();

    expect(editGestureController.hasActiveGesture()).toBe(false);
    // 배치 간격 커밋처럼 committed echo가 다른 gestureId로 향하면
    // 원격 창 세션이 잔존하므로 성공 경로에도 보조 cancel이 나가야 함
    expect(previewApi.cancel).toHaveBeenCalledTimes(1);
    expect(previewApi.cancel).toHaveBeenCalledWith(sessionId);
    expect(useKeyStore.getState().positions['4key'][0].width).toBe(60);
  });

  it('settleCommit 실패 시 세션 유지', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    editGestureController.preview('4key', [
      { index: 0, patch: { width: 100 } },
    ]);

    editGestureController.settleCommit(Promise.reject(new Error('io')));
    await flushPromises();

    expect(editGestureController.hasActiveGesture()).toBe(true);
    expect(useKeyStore.getState().positions['4key'][0].width).toBe(100);
  });

  it('settleCommit 실패 뒤 편집 대상이 갈렸으면 세션을 되살리지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-0', index: 0 }],
    });
    editGestureController.preview('4key', [
      { index: 0, patch: { width: 100 } },
    ]);

    editGestureController.settleCommit(Promise.reject(new Error('io')));
    // 정산이 끝나기 전에 선택이 다른 요소로 넘어간다 (분리 패널 selection sync)
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-1', index: 1 }],
    });
    await flushPromises();

    // 되살리면 index 0 patch가 다음 커밋 경계에서 남의 값을 덮는다
    expect(editGestureController.hasActiveGesture()).toBe(false);
  });

  it('cancel은 canonical을 건드리지 않고 오버레이만 제거', () => {
    editGestureController.preview('4key', [
      { index: 0, patch: { width: 150 } },
    ]);
    editGestureController.cancel();

    const state = useKeyStore.getState();
    expect(state.positions['4key'][0].width).toBe(60);
    expect(state.canonicalPositions['4key'][0].width).toBe(60);
    expect(editGestureController.hasActiveGesture()).toBe(false);
  });

  it('stat 프리뷰 Escape 취소는 canonical 값으로 원복', () => {
    editGestureController.preview(
      '4key',
      [{ index: 0, patch: { width: 150 } }],
      { domain: 'statPosition' },
    );

    expect(
      composePreviewPositions(
        'statPosition',
        useStatItemStore.getState().positions,
      )['4key'][0].width,
    ).toBe(150);

    editGestureController.cancel();

    expect(useStatItemStore.getState().positions['4key'][0].width).toBe(60);
    expect(
      composePreviewPositions(
        'statPosition',
        useStatItemStore.getState().positions,
      )['4key'][0].width,
    ).toBe(60);
  });

  it('서로 다른 도메인의 같은 patch를 별도 채널 메시지로 발행', async () => {
    editGestureController.preview('4key', [{ index: 0, patch: { width: 90 } }]);
    editGestureController.preview(
      '4key',
      [{ index: 0, patch: { width: 90 } }],
      { domain: 'statPosition' },
    );

    await flushPromises();

    expect(vi.mocked(previewApi.publish)).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(previewApi.publish)
        .mock.calls.map(([request]) => request.domain),
    ).toEqual(['keyPosition', 'statPosition']);
  });

  it('commitPending은 네 도메인 누적 patch를 한 editor commit으로 승격', async () => {
    editGestureController.preview('4key', [{ index: 0, patch: { width: 90 } }]);
    editGestureController.preview(
      '4key',
      [{ index: 0, patch: { width: 100 } }],
      { domain: 'statPosition' },
    );
    editGestureController.preview(
      '4key',
      [{ index: 0, patch: { width: 110 } }],
      { domain: 'graphPosition' },
    );
    editGestureController.preview(
      '4key',
      [{ index: 0, patch: { width: 120 } }],
      { domain: 'knobPosition' },
    );
    const sessionId = editGestureController.activeGestureId();

    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );

    expect(commitPatchMock).toHaveBeenCalledOnce();
    expect(commitPatchMock).toHaveBeenCalledWith(
      {
        schemaVersion: 1,
        keyPositions: {
          '4key': [expect.objectContaining({ width: 90 }), expect.any(Object)],
        },
        statPositions: { '4key': [expect.objectContaining({ width: 100 })] },
        graphPositions: { '4key': [expect.objectContaining({ width: 110 })] },
        knobPositions: { '4key': [expect.objectContaining({ width: 120 })] },
      },
      { gestureId: sessionId },
    );
    expect(editGestureController.hasActiveGesture()).toBe(false);
  });

  it('모드가 바뀌면 이전 게스처를 취소하고 새로 시작', () => {
    editGestureController.preview('4key', [{ index: 0, patch: { width: 90 } }]);
    const first = editGestureController.activeGestureId();

    editGestureController.preview('5key', [{ index: 0, patch: { width: 95 } }]);

    expect(editGestureController.activeGestureId()).not.toBe(first);
    expect(previewApi.cancel).toHaveBeenCalledWith(first);
  });
});
