// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalReactiveSpritePosition,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorDocumentV1,
} from '@src/types/editor';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

const SPRITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// IPC 경계만 대역. 게스처 컨트롤러·프리뷰 오버레이·스토어·coordinator는 실물이라
// 단위 테스트가 mock으로 가려 두던 "드래그 중 canonical 교체" 경로까지 지나간다
const runtime = vi.hoisted(() => {
  let resolveCommit!: (result: EditorCommitResult) => void;
  const commit = vi.fn(
    (_request: EditorCommitRequest) =>
      new Promise<EditorCommitResult>((resolve) => {
        resolveCommit = resolve;
      }),
  );
  const get = vi.fn();
  let committedListener: ((event: EditorCommittedV1) => void) | null = null;
  const onCommitted = vi.fn((listener: (event: EditorCommittedV1) => void) => {
    committedListener = listener;
    return Object.assign(() => {}, { ready: Promise.resolve() });
  });
  return {
    commit,
    get,
    onCommitted,
    emitCommitted: (event: EditorCommittedV1) => committedListener?.(event),
    resolveCommit: (result: EditorCommitResult) => resolveCommit(result),
    previewPublish: vi.fn(async () => {}),
    previewCancel: vi.fn(async () => {}),
    previewSubscribe: vi.fn(async () => 1),
  };
});

vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: runtime.get,
    commit: runtime.commit,
    onCommitted: runtime.onCommitted,
  },
}));
vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    publish: runtime.previewPublish,
    cancel: runtime.previewCancel,
    subscribe: runtime.previewSubscribe,
  },
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const spriteFixture = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  activation: 'whileHeld',
  pressDurationMs: 300,
  id: SPRITE_ID,
  dx: 0,
  dy: 0,
  width: 200,
  height: 150,
  hidden: false,
  zIndex: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [
    {
      poseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      triggers: [KEY_ID_A],
      transform: { x: 10, y: 0, rotation: 90, scale: 1 },
      imageOverride: null,
      imageOverrideMetrics: null,
    },
  ],
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  referenceNaturalSize: null,
  ...overrides,
});

const makeDocument = (
  sprite: CanonicalReactiveSpritePosition,
): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: {},
  keyPositions: {},
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: { '4key': [sprite] },
  layerGroups: {},
});

const loadHarness = async () => {
  const [handles, overlay, spriteStore, coordinator, dragSession] =
    await Promise.all([
      import('./SpriteCanvasHandles'),
      import('@src/renderer/editor/runtime/previewOverlay'),
      import('@stores/data/useSpriteStore'),
      import('@src/renderer/editor/runtime/editorStateCoordinator'),
      import('@hooks/Grid/dragSession'),
    ]);
  return {
    SpriteCanvasHandles: handles.default,
    composePreviewPositions: overlay.composePreviewPositions,
    previewOverlay: overlay.previewOverlay,
    subscribePreviewOverlay: overlay.subscribePreviewOverlay,
    getPreviewOverlayVersion: overlay.getPreviewOverlayVersion,
    useSpriteStore: spriteStore.useSpriteStore,
    editorCoordinator: coordinator.editorCoordinator,
    releaseDragSession: dragSession.releaseDragSession,
  };
};
type Harness = Awaited<ReturnType<typeof loadHarness>>;

describe('SpriteCanvasHandles 기준점 드래그 통합', () => {
  let harness: Harness;
  let container: HTMLDivElement;
  let root: Root;
  const selected: SelectedElement[] = [{ type: 'sprite', id: SPRITE_ID }];

  // Grid와 같은 합성: canonical 위에 프리뷰 오버레이를 얹어 핸들에 넘긴다
  const Host = () => {
    const canonical = harness.useSpriteStore((state) => state.positions);
    useSyncExternalStore(
      harness.subscribePreviewOverlay,
      harness.getPreviewOverlayVersion,
    );
    const spritePositions = harness.composePreviewPositions(
      'spritePosition',
      canonical,
    );
    return (
      <harness.SpriteCanvasHandles
        spritePositions={spritePositions}
        selectedElements={selected}
        selectedKeyType="4key"
        zoom={1}
        panX={0}
        panY={0}
      />
    );
  };

  const render = () => act(() => root.render(<Host />));
  const pivotHandle = () =>
    container.querySelector<HTMLElement>('[data-sprite-pivot-handle="true"]')!;
  const pointer = (
    type: string,
    target: EventTarget,
    clientX: number,
    clientY: number,
    init: { ctrlKey?: boolean } = {},
  ) =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX,
          clientY,
          pointerId: 1,
          ctrlKey: init.ctrlKey ?? false,
        }),
      );
    });
  const handleCenterX = () => parseFloat(pivotHandle().style.left) + 13;
  // rAF 스케줄러가 setTimeout 0으로 스텁돼 있어 한 틱 기다리면 move가 반영된다
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

  beforeEach(async () => {
    vi.resetModules();
    runtime.commit.mockClear();
    runtime.previewPublish.mockClear();
    runtime.previewCancel.mockClear();
    runtime.get.mockReset();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    harness = await loadHarness();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    harness.releaseDragSession();
    harness.editorCoordinator.stop();
    vi.unstubAllGlobals();
  });

  it('중앙에 스냅된 기준점을 드래그하면 표식이 따라가고 커밋 뒤에도 유지된다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    // 중앙 (100, 75) → 히트 26 좌상단 (87, 62)
    expect(pivotHandle().style.left).toBe('87px');
    expect(pivotHandle().style.top).toBe('62px');

    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 160, 75);
    await settle();
    // pivot x = 0.8 → 축 160 + 프레임 보정 0.6 → 히트 좌상단 147.6
    expect(parseFloat(pivotHandle().style.left)).toBeCloseTo(147.6, 3);

    pointer('pointermove', window, 180, 90);
    await settle();
    // 두 번째 move도 살아 있다 - 드래그가 도중에 취소되지 않았다
    expect(parseFloat(pivotHandle().style.left)).toBeCloseTo(167.8, 3);
    expect(parseFloat(pivotHandle().style.top)).toBeCloseTo(77.2, 3);

    pointer('pointerup', window, 180, 90);
    await settle();
    expect(runtime.commit).toHaveBeenCalledOnce();
    const canonical = harness.useSpriteStore.getState().positions['4key'][0];
    expect(canonical.pivot).toEqual({ x: 0.9, y: 0.6 });
    // 표식은 드래그를 놓은 자리에 남는다
    expect(parseFloat(pivotHandle().style.left)).toBeCloseTo(167.8, 3);

    runtime.resolveCommit({ revision: 1, changedFields: ['spritePositions'] });
    await settle();
    expect(parseFloat(pivotHandle().style.left)).toBeCloseTo(167.8, 3);
    expect(
      harness.useSpriteStore.getState().positions['4key'][0].pivot,
    ).toEqual({ x: 0.9, y: 0.6 });
  });

  it('직전 커밋이 착지한 직후 중앙에서 시작한 두 번째 드래그도 이어진다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture({ pivot: { x: 1, y: 0 } })),
    });
    await harness.editorCoordinator.start();
    render();

    // 1차: 모서리 → 중앙으로 드래그해 스냅
    pointer('pointerdown', pivotHandle(), 201, -1);
    pointer('pointermove', window, 102, 77);
    await settle();
    pointer('pointerup', window, 102, 77);
    await settle();
    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(
      harness.useSpriteStore.getState().positions['4key'][0].pivot,
    ).toEqual({ x: 0.5, y: 0.5 });
    runtime.resolveCommit({ revision: 1, changedFields: ['spritePositions'] });
    await settle();
    expect(pivotHandle().style.left).toBe('87px');

    // 2차: 중앙에서 바로 다른 곳으로
    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 140, 75);
    await settle();
    expect(parseFloat(pivotHandle().style.left)).toBeCloseTo(127.4, 3);

    pointer('pointermove', window, 160, 75);
    await settle();
    expect(parseFloat(pivotHandle().style.left)).toBeCloseTo(147.6, 3);

    pointer('pointerup', window, 160, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    expect(
      harness.useSpriteStore.getState().positions['4key'][0].pivot,
    ).toEqual({ x: 0.8, y: 0.5 });
  });

  it('배율 0.1 idle 스프라이트도 표식이 포인터를 그대로 따라간다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(
        spriteFixture({
          idleTransform: { x: 0, y: 0, rotation: 0, scale: 0.1 },
        }),
      ),
    });
    await harness.editorCoordinator.start();
    render();
    expect(handleCenterX()).toBeCloseTo(100, 6);

    pointer('pointerdown', pivotHandle(), 100, 75);
    // 스냅이 켜진 채 1px - 프리셋 자리가 7.5px 간격으로 몰려도 옆 프리셋으로 튀지 않는다
    pointer('pointermove', window, 100, 74);
    await settle();
    expect(handleCenterX()).toBeCloseTo(100, 6);
    expect(parseFloat(pivotHandle().style.top) + 13).toBeCloseTo(75, 6);
    // 스냅 해제 상태로 5px - 배율 0.1이라 기준점은 0.25 움직이고 표식은 포인터 아래
    pointer('pointermove', window, 105, 75, { ctrlKey: true });
    await settle();
    // 105 + 프레임 보정 (2·0.75−1)·1 = 105.5
    expect(handleCenterX()).toBeCloseTo(105.5, 6);

    pointer('pointerup', window, 105, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledOnce();
    const canonical = harness.useSpriteStore.getState().positions['4key'][0];
    expect(canonical.pivot.x).toBeCloseTo(0.75, 9);
    expect(canonical.pivot.y).toBeCloseTo(0.5, 9);
    // 그림은 움직이지 않는다 - t' = t + (P − P') + sR·Δ = 0 + (100 − 150) + 0.1·50
    expect(canonical.idleTransform.x).toBeCloseTo(-45, 9);
    expect(handleCenterX()).toBeCloseTo(105.5, 6);
  });

  it('히트 영역 가장자리를 잡아도 첫 move에서 표식이 튀지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    // 중심에서 8px 오른쪽을 잡고 4px 이동 → 표식은 4px만 따라온다
    pointer('pointerdown', pivotHandle(), 108, 75);
    pointer('pointermove', window, 112, 75, { ctrlKey: true });
    await settle();
    // 축 104 + 프레임 보정 (2·0.52−1)·1 = 104.04
    expect(handleCenterX()).toBeCloseTo(104.04, 6);
    pointer('pointerup', window, 112, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(
      harness.useSpriteStore.getState().positions['4key'][0].pivot.x,
    ).toBeCloseTo(0.52, 9);
  });

  it('표시 기준점이 canonical과 다르면(다른 프리뷰 진행 중) 드래그를 시작하지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();
    const { editGestureController } = await import(
      '@src/renderer/editor/runtime/editGestureController'
    );
    // 다른 컨트롤의 프리뷰가 기준점을 0.75로 보여 주는 상태
    act(() =>
      editGestureController.preview(
        '4key',
        [
          {
            id: SPRITE_ID,
            patch: {
              pivot: { x: 0.75, y: 0.5 },
              idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
            },
          },
        ],
        { domain: 'spritePosition' },
      ),
    );
    await settle();
    expect(handleCenterX()).toBeCloseTo(150.5, 6);

    pointer('pointerdown', pivotHandle(), 150, 75);
    pointer('pointermove', window, 120, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 120, 75);
    await settle();
    expect(runtime.commit).not.toHaveBeenCalled();
    expect(handleCenterX()).toBeCloseTo(150.5, 6);
    act(() => editGestureController.cancel());
  });

  it('컨트롤러가 잃어버린 로컬 프리뷰가 기준점을 가려도 한 번의 드래그로 회수하고 저장한다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    const orphanSessionId = '11111111-1111-4111-8111-111111111111';
    act(() => {
      harness.previewOverlay.applyLocalPatchByIds(
        orphanSessionId,
        '4key',
        [SPRITE_ID],
        {
          pivot: { x: 0.75, y: 0.5 },
          idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
        },
        'spritePosition',
      );
    });
    await settle();
    expect(handleCenterX()).toBeCloseTo(150.5, 6);

    pointer('pointerdown', pivotHandle(), 150, 75);
    pointer('pointermove', window, 120, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 120, 75);
    await settle();

    expect(runtime.previewCancel).toHaveBeenCalledWith(orphanSessionId);
    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(
      harness.useSpriteStore.getState().positions['4key'][0].pivot.x,
    ).toBeCloseTo(0.6, 9);
    expect(handleCenterX()).toBeCloseTo(120.2, 6);
  });

  it('다른 프리뷰가 상자 크기만 바꿔 보여 줘도 드래그를 시작하지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();
    const { editGestureController } = await import(
      '@src/renderer/editor/runtime/editGestureController'
    );
    // 기준점·transform은 canonical 그대로, 상자만 두 배로 보이는 프리뷰
    act(() =>
      editGestureController.preview(
        '4key',
        [{ id: SPRITE_ID, patch: { width: 400, height: 300 } }],
        { domain: 'spritePosition' },
      ),
    );
    await settle();
    // 표시 표식은 두 배 상자의 중앙 (200, 150)
    expect(handleCenterX()).toBeCloseTo(200, 6);

    pointer('pointerdown', pivotHandle(), 200, 150);
    pointer('pointermove', window, 200, 150, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 200, 150);
    await settle();
    expect(runtime.commit).not.toHaveBeenCalled();
    expect(
      harness.useSpriteStore.getState().positions['4key'][0].pivot,
    ).toEqual({ x: 0.5, y: 0.5 });
    act(() => editGestureController.cancel());
  });
});
