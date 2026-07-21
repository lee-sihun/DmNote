import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  composePreviewPositions,
  previewOverlay,
  registerPreviewRevisionProbe,
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

  it('minRevision 게이트에 걸린 cancel은 revision 전진 후에만 처리', () => {
    let currentRevision: number | null = 3;
    registerPreviewRevisionProbe(() => currentRevision);

    previewOverlay.applyRemoteEnvelope(remoteEnvelope({ seq: 1 }));
    previewOverlay.applyRemoteEnvelope(
      remoteEnvelope({
        seq: 2,
        kind: 'cancel',
        targets: [],
        patch: {},
        minRevision: 5,
      }),
    );

    // 아직 revision 미도달이라 프리뷰 유지
    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#ff0000',
    );

    currentRevision = 5;
    previewOverlay.flushDeferredCancels(5);
    expect(
      useKeyStore.getState().positions['4key'][0].backgroundColor,
    ).toBeUndefined();

    registerPreviewRevisionProbe(null);
  });

  it('revision이 이미 도달한 cancel은 즉시 처리', () => {
    registerPreviewRevisionProbe(() => 10);

    previewOverlay.applyRemoteEnvelope(remoteEnvelope({ seq: 1 }));
    previewOverlay.applyRemoteEnvelope(
      remoteEnvelope({
        seq: 2,
        kind: 'cancel',
        targets: [],
        patch: {},
        minRevision: 5,
      }),
    );

    expect(
      useKeyStore.getState().positions['4key'][0].backgroundColor,
    ).toBeUndefined();

    registerPreviewRevisionProbe(null);
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

  it('settleCommit 성공 시 세션 종료 + 수신측 정리 브로드캐스트', async () => {
    editGestureController.preview('4key', [
      { index: 0, patch: { width: 100 } },
    ]);
    const sessionId = editGestureController.activeGestureId();

    editGestureController.settleCommit(Promise.resolve());
    await flushPromises();

    expect(editGestureController.hasActiveGesture()).toBe(false);
    // 커밋 revision 미확정(null) 상태에서는 게이트 없이 보조 cancel 발송
    expect(previewApi.cancel).toHaveBeenCalledWith(sessionId, undefined);
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
