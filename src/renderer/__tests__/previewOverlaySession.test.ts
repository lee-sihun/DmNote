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
import { runExclusiveLegacyMutation } from '@src/renderer/editor/runtime/legacyEditorMutation';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { previewApi } from '@api/modules/previewApi';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PreviewEnvelope } from '@src/types/preview';

const KEY_ID_A = '00000000-0000-4000-8000-000000000101';
const KEY_ID_B = '00000000-0000-4000-8000-000000000102';
const KEY_ID_C = '00000000-0000-4000-8000-000000000103';
const STAT_ID_A = '00000000-0000-4000-8000-000000000201';
const GRAPH_ID_A = '00000000-0000-4000-8000-000000000301';
const KNOB_ID_A = '00000000-0000-4000-8000-000000000401';

const { commitPatchMock, commitGeneratedPatchMock, generatedPatches } =
  vi.hoisted(() => ({
    commitPatchMock: vi.fn().mockResolvedValue(undefined),
    commitGeneratedPatchMock: vi.fn(),
    generatedPatches: [] as Array<unknown>,
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
    commitGeneratedPatch: commitGeneratedPatchMock,
    runExclusiveLegacyMutation: vi.fn(
      async (mutation: () => Promise<unknown>) => mutation(),
    ),
    getState: () => ({ revision: null }),
  },
}));

const basePosition = (dx: number, id: string) => ({
  ...createDefaultKeyPosition(),
  id,
  dx,
  dy: 0,
  width: 60,
  height: 60,
});

const canonicalFixture = (): CanonicalEditorDocumentV1['keyPositions'] =>
  ({
    '4key': [basePosition(0, KEY_ID_A), basePosition(70, KEY_ID_B)],
  } as CanonicalEditorDocumentV1['keyPositions']);

const statFixture = (): CanonicalEditorDocumentV1['statPositions'] =>
  ({
    '4key': [{ ...basePosition(0, STAT_ID_A), statType: 'kps' }],
  } as CanonicalEditorDocumentV1['statPositions']);

const graphFixture = (): CanonicalEditorDocumentV1['graphPositions'] =>
  ({
    '4key': [
      {
        ...basePosition(0, GRAPH_ID_A),
        statType: 'kps',
        graphType: 'line',
        graphSpeed: 1,
        graphColor: '#ffffff',
      },
    ],
  } as CanonicalEditorDocumentV1['graphPositions']);

const knobFixture = (): CanonicalEditorDocumentV1['knobPositions'] =>
  ({
    '4key': [
      {
        ...basePosition(0, KNOB_ID_A),
        axisId: 'HIDA:test',
        sensitivity: 1,
        reverse: false,
      },
    ],
  } as CanonicalEditorDocumentV1['knobPositions']);

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
    generatedPatches.length = 0;
    // 슬롯 시점 base = 호출 시점 스토어 상태. 대기 중 재정렬·삭제 시뮬레이션은
    // 테스트가 commitPendingAsync 호출 전에 스토어를 바꿔 재현한다
    commitGeneratedPatchMock.mockImplementation(
      async (generate: (base: unknown) => unknown) => {
        const base = {
          schemaVersion: 1,
          keys: {},
          keyPositions: structuredClone(
            useKeyStore.getState().canonicalPositions,
          ),
          statPositions: structuredClone(useStatItemStore.getState().positions),
          graphPositions: structuredClone(
            useGraphItemStore.getState().positions,
          ),
          knobPositions: structuredClone(useKnobItemStore.getState().positions),
          layerGroups: {},
        };
        generatedPatches.push(generate(base));
        return base;
      },
    );
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
      { id: KEY_ID_A, patch: { backgroundColor: '#abcdef' } },
    ]);

    expect(editGestureController.hasActiveGesture()).toBe(true);
    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#abcdef',
    );
  });

  it('새 게스처는 남은 로컬 프리뷰를 교체하고 브로커에도 종료를 알린다', () => {
    const staleSessionId = '11111111-1111-4111-8111-111111111111';
    previewOverlay.applyLocalPatch(staleSessionId, '4key', [0], {
      backgroundColor: '#111111',
    });

    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { backgroundColor: '#abcdef' } },
    ]);

    expect(previewApi.cancel).toHaveBeenCalledWith(staleSessionId);
    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#abcdef',
    );
  });

  it('활성 게스처가 없어도 cancel은 남은 로컬 프리뷰를 회수한다', () => {
    const staleSessionId = '11111111-1111-4111-8111-111111111111';
    const canonicalColor =
      useKeyStore.getState().positions['4key'][0].backgroundColor;
    previewOverlay.applyLocalPatch(staleSessionId, '4key', [0], {
      backgroundColor: '#111111',
    });

    editGestureController.cancel();

    expect(previewApi.cancel).toHaveBeenCalledWith(staleSessionId);
    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      canonicalColor,
    );
  });

  it('preview는 coalescing 후 채널로 발행됨', async () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { backgroundColor: '#111111' } },
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

    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 1 } },
    ]);
    await flushPromises();
    expect(previewApi.publish).toHaveBeenCalledTimes(1);

    // in-flight 하나가 도는 동안 값이 계속 바뀐다 (드래그, 방향키 꾹 누르기)
    for (const width of [2, 3, 4, 5]) {
      editGestureController.preview('4key', [
        { id: KEY_ID_A, patch: { width } },
      ]);
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
      { id: KEY_ID_A, patch: { width: 10 } },
      { id: KEY_ID_B, patch: { width: 20 } },
    ]);
    await flushPromises();
    expect(previewApi.publish).toHaveBeenCalledTimes(1);

    editGestureController.preview('4key', [
      { id: KEY_ID_B, patch: { width: 30 } },
    ]);
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
      { id: KEY_ID_A, patch: { width: 42 } },
      { id: KEY_ID_B, patch: { width: 42 } },
    ]);
    await flushPromises();

    expect(previewApi.publish).toHaveBeenCalledTimes(1);
    const request = vi.mocked(previewApi.publish).mock.calls[0][0];
    expect(request.targets).toEqual([0, 1]);
    expect(request.patch).toEqual({ width: 42 });
  });

  it('settleCommit 성공 시 로컬 세션 종료 + 보조 cancel 브로드캐스트', async () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 100 } },
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
      { id: KEY_ID_A, patch: { width: 100 } },
    ]);

    editGestureController.settleCommit(Promise.reject(new Error('io')));
    await flushPromises();

    expect(editGestureController.hasActiveGesture()).toBe(true);
    expect(useKeyStore.getState().positions['4key'][0].width).toBe(100);
  });

  it('새 조작이 교체한 정산 대기 세션은 늦게 실패해도 되살아나지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let rejectFirst!: (reason: Error) => void;
    const firstCommit = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });

    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 100 } },
    ]);
    editGestureController.settleCommit(firstCommit);

    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 120 } },
    ]);
    editGestureController.cancel();
    rejectFirst(new Error('late io'));
    await flushPromises();

    expect(editGestureController.hasActiveGesture()).toBe(false);
    expect(useKeyStore.getState().positions['4key'][0].width).toBe(60);
  });

  it('settleCommit 실패 뒤 편집 대상이 갈렸으면 세션을 되살리지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-0', index: 0 }],
    });
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 100 } },
    ]);

    editGestureController.settleCommit(Promise.reject(new Error('io')));
    // 정산이 끝나기 전에 선택이 다른 요소로 넘어간다 (분리 패널 selection sync)
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-1', index: 1 }],
    });
    await flushPromises();

    // 되살리면 이미 떠난 대상의 patch가 다음 커밋 경계에 실린다
    expect(editGestureController.hasActiveGesture()).toBe(false);
  });

  it('cancel은 canonical을 건드리지 않고 오버레이만 제거', () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 150 } },
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
      [{ id: STAT_ID_A, patch: { width: 150 } }],
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
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);
    editGestureController.preview(
      '4key',
      [{ id: STAT_ID_A, patch: { width: 90 } }],
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
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);
    editGestureController.preview(
      '4key',
      [{ id: STAT_ID_A, patch: { width: 100 } }],
      { domain: 'statPosition' },
    );
    editGestureController.preview(
      '4key',
      [{ id: GRAPH_ID_A, patch: { width: 110 } }],
      { domain: 'graphPosition' },
    );
    editGestureController.preview(
      '4key',
      [{ id: KNOB_ID_A, patch: { width: 120 } }],
      { domain: 'knobPosition' },
    );
    const sessionId = editGestureController.activeGestureId();

    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );

    // wire는 슬롯 안에서 최신 base로 재생성 - 호출 시점 full-record 금지
    expect(commitPatchMock).not.toHaveBeenCalled();
    expect(commitGeneratedPatchMock).toHaveBeenCalledOnce();
    expect(commitGeneratedPatchMock.mock.calls[0][1]).toMatchObject({
      gestureId: sessionId,
    });
    const patch = generatedPatches[0] as {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
      statPositions?: Record<string, Array<Record<string, unknown>>>;
      graphPositions?: Record<string, Array<Record<string, unknown>>>;
      knobPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(patch.keyPositions?.['4key'][0]).toMatchObject({
      id: KEY_ID_A,
      width: 90,
    });
    expect(patch.statPositions?.['4key'][0]).toMatchObject({ width: 100 });
    expect(patch.graphPositions?.['4key'][0]).toMatchObject({ width: 110 });
    expect(patch.knobPositions?.['4key'][0]).toMatchObject({ width: 120 });
    expect(editGestureController.hasActiveGesture()).toBe(false);
  });

  it('정산은 스토어에 즉시 반영된다 - 후행 full-record 캡처 자가 치유', () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);

    void editGestureController.commitPendingAsync();

    expect(useKeyStore.getState().canonicalPositions['4key'][0].width).toBe(90);
  });

  it('정산 대기 중 재정렬돼도 생성 patch가 같은 id를 따라간다', async () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);

    // 슬롯 진입 전 재정렬 시뮬레이션: base가 뒤집힌 상태로 생성됨
    const [a, b] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.setState({
      canonicalPositions: { '4key': [b, a] } as never,
      positions: { '4key': [b, a] } as never,
    });

    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );

    const patch = generatedPatches[0] as {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    // 시작 시점 index 0 = key-id-a, 재정렬 후에는 index 1
    expect(patch.keyPositions?.['4key'][1]).toMatchObject({
      id: KEY_ID_A,
      width: 90,
    });
    expect(patch.keyPositions?.['4key'][0].width).toBe(60);
  });

  it('활성 gesture 중 reorder돼도 preview와 commit이 시작 ID를 따라간다', async () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 80 } },
    ]);

    const [a, b] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.setState({
      canonicalPositions: { '4key': [b, a] } as never,
      positions: { '4key': [b, a] } as never,
    });
    // 재정렬로 live index가 밀려도 신원은 id가 결정한다
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 95 } },
    ]);
    await flushPromises();

    expect(useKeyStore.getState().positions['4key'][0]).toMatchObject({
      id: KEY_ID_B,
      width: 60,
    });
    expect(useKeyStore.getState().positions['4key'][1]).toMatchObject({
      id: KEY_ID_A,
      width: 95,
    });
    expect(
      vi.mocked(previewApi.publish).mock.calls.at(-1)?.[0].targets,
    ).toEqual([1]);

    await editGestureController.commitPendingAsync();
    const patch = generatedPatches[0] as {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(patch.keyPositions?.['4key'][0]).toMatchObject({
      id: KEY_ID_B,
      width: 60,
    });
    expect(patch.keyPositions?.['4key'][1]).toMatchObject({
      id: KEY_ID_A,
      width: 95,
    });
  });

  // [C, A, B] 배치 - A·B만 선택된 게스처 중 비선택 C가 삭제되는 오염 사슬 재현용
  const setThreeKeyState = () => {
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          basePosition(0, KEY_ID_C),
          basePosition(70, KEY_ID_A),
          basePosition(140, KEY_ID_B),
        ],
      } as never,
      positions: {
        '4key': [
          basePosition(0, KEY_ID_C),
          basePosition(70, KEY_ID_A),
          basePosition(140, KEY_ID_B),
        ],
      } as never,
    });
  };

  // 격리 커밋의 canonical 적용 시뮬레이션 - setPositions가 rendered 재합성까지 수행
  const dropFirstKey = () => {
    const [, ...rest] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.getState().setPositions({ '4key': rest } as never);
  };

  it('게스처 중 비대상 삭제로 index가 밀려도 id 전달 patch는 제 요소에 누적·커밋된다', async () => {
    setThreeKeyState();

    // A·B 배치 프리뷰: 요소별 상이 patch
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { fontColor: '#aa0000' } },
      { id: KEY_ID_B, patch: { fontColor: '#bb0000' } },
    ]);

    // 게스처와 미배타인 격리 커밋이 비선택 C를 삭제 - A·B index가 당겨진다
    dropFirstKey();

    // 드래그 계속 - 밀린 index와 무관하게 id가 제 요소를 가리킨다
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { fontColor: '#aa1111' } },
      { id: KEY_ID_B, patch: { fontColor: '#bb1111' } },
    ]);

    const rendered = useKeyStore.getState().positions['4key'];
    expect(rendered[0]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#aa1111',
    });
    expect(rendered[1]).toMatchObject({
      id: KEY_ID_B,
      fontColor: '#bb1111',
    });

    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );
    const patch = generatedPatches[0] as {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(patch.keyPositions?.['4key'][0]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#aa1111',
    });
    expect(patch.keyPositions?.['4key'][1]).toMatchObject({
      id: KEY_ID_B,
      fontColor: '#bb1111',
    });
  });

  it('정산 실패로 부활한 세션도 id 기준으로 제 요소에 patch를 잇는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setThreeKeyState();
    // 부활 판정은 편집 대상 지문 - 게스처 동안 선택 불변 전제를 고정
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: KEY_ID_A, index: 1 },
        { type: 'key', id: KEY_ID_B, index: 2 },
      ],
    });

    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { fontColor: '#aa0000' } },
      { id: KEY_ID_B, patch: { fontColor: '#bb0000' } },
    ]);
    editGestureController.settleCommit(Promise.reject(new Error('io')));
    await flushPromises();
    expect(editGestureController.hasActiveGesture()).toBe(true);

    // 부활한 세션에서 C 삭제로 index가 밀려도 id가 신원을 유지한다
    dropFirstKey();
    editGestureController.preview('4key', [
      { id: KEY_ID_B, patch: { fontColor: '#bb1111' } },
    ]);

    const rendered = useKeyStore.getState().positions['4key'];
    expect(rendered[0]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#aa0000',
    });
    expect(rendered[1]).toMatchObject({
      id: KEY_ID_B,
      fontColor: '#bb1111',
    });

    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );
    const patch = generatedPatches[0] as {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(patch.keyPositions?.['4key'][0]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#aa0000',
    });
    expect(patch.keyPositions?.['4key'][1]).toMatchObject({
      id: KEY_ID_B,
      fontColor: '#bb1111',
    });
  });

  it('비 native id 항목은 스토어에 점유자가 있어도 fail-closed로 무시된다', async () => {
    // 손상·레거시 상태로 비 native id가 스토어에 남아 있어도 신원으로 승격 금지
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [basePosition(0, 'legacy-key'), basePosition(70, KEY_ID_A)],
      } as never,
      positions: {
        '4key': [basePosition(0, 'legacy-key'), basePosition(70, KEY_ID_A)],
      } as never,
    });

    editGestureController.preview('4key', [
      { id: 'legacy-key', patch: { fontColor: '#poison' } },
      { id: KEY_ID_A, patch: { fontColor: '#aa0000' } },
    ]);

    const rendered = useKeyStore.getState().positions['4key'];
    expect((rendered[0] as Record<string, unknown>).fontColor).toBeUndefined();
    expect(rendered[1]).toMatchObject({ id: KEY_ID_A, fontColor: '#aa0000' });

    // skip은 정산까지 이어진다 - wire patch에 legacy 점유자 변경이 실리지 않는다
    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );
    const patch = generatedPatches[0] as {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(patch.keyPositions?.['4key'][0].id).toBe('legacy-key');
    expect(patch.keyPositions?.['4key'][0].fontColor).toBeUndefined();
    expect(patch.keyPositions?.['4key'][1]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#aa0000',
    });
  });

  it('비 native 전용 preview는 게스처 세션을 만들지 않는다', async () => {
    editGestureController.preview('4key', [
      { id: 'legacy-key', patch: { fontColor: '#poison' } },
    ]);
    await flushPromises();

    expect(editGestureController.hasActiveGesture()).toBe(false);
    expect(editGestureController.activeGestureId()).toBeNull();
    expect(previewApi.publish).not.toHaveBeenCalled();
  });

  it('활성 세션 중 비 native 전용 preview는 세션을 죽이지 않는다', () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { fontColor: '#aa0000' } },
    ]);
    const sessionId = editGestureController.activeGestureId();
    expect(sessionId).not.toBeNull();

    editGestureController.preview('4key', [
      { id: 'legacy-key', patch: { fontColor: '#poison' } },
    ]);

    expect(editGestureController.activeGestureId()).toBe(sessionId);
    expect(useKeyStore.getState().positions['4key'][0]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#aa0000',
    });
  });

  it('정산 대기 중 대상이 삭제되면 커밋하지 않는다', async () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_B, patch: { width: 90 } },
    ]);

    const [a] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.setState({
      canonicalPositions: { '4key': [a] } as never,
      positions: { '4key': [a] } as never,
    });

    await expect(editGestureController.commitPendingAsync()).resolves.toBe(
      true,
    );

    // generator가 null을 반환해 무커밋 (mock이 null patch를 기록)
    expect(generatedPatches[0]).toBeNull();
  });

  it('배타 mutation은 정산 실패한 A만 폐기하고 대기 중 시작된 B는 유지한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A의 정산 커밋을 지연시켜 실패 예약
    let rejectSettle!: (reason: Error) => void;
    commitGeneratedPatchMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSettle = reject;
        }),
    );

    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);
    const gestureA = editGestureController.activeGestureId();

    const run = runExclusiveLegacyMutation(async () => 'done');
    // 정산 enqueue가 A를 비운 뒤 사용자가 새 게스처 B 시작
    await Promise.resolve();
    await Promise.resolve();
    editGestureController.preview('4key', [
      { id: KEY_ID_B, patch: { width: 120 } },
    ]);
    const gestureB = editGestureController.activeGestureId();
    expect(gestureB).not.toBe(gestureA);

    rejectSettle(new Error('settle failed'));
    await run;

    // A는 복원되지 않고(B가 활성), B는 폐기되지 않는다
    expect(editGestureController.activeGestureId()).toBe(gestureB);
  });

  it('모드가 바뀌면 이전 게스처를 취소하고 새로 시작', () => {
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);
    const first = editGestureController.activeGestureId();

    editGestureController.preview('5key', [
      { id: KEY_ID_A, patch: { width: 95 } },
    ]);

    expect(editGestureController.activeGestureId()).not.toBe(first);
    expect(previewApi.cancel).toHaveBeenCalledWith(first);
  });

  it('구분자 포함 id의 서로 다른 선택은 다른 지문으로 barrier를 발화한다', () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'plugin', id: 'a|plugin:b' }],
    });
    editGestureController.preview('4key', [
      { id: KEY_ID_A, patch: { width: 90 } },
    ]);
    expect(editGestureController.hasActiveGesture()).toBe(true);

    // 이어붙이기 지문이면 두 선택 모두 'plugin:a|plugin:b'로 충돌해 미발화
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'plugin', id: 'a' },
        { type: 'plugin', id: 'b' },
      ],
    });
    expect(editGestureController.hasActiveGesture()).toBe(false);
  });
});
