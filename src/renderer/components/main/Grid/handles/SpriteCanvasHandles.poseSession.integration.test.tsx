// @vitest-environment jsdom
import React, { act, createRef, useSyncExternalStore } from 'react';
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
const POSE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// 패널 + 캔버스 핸들 + 실물 게스처 컨트롤러·오버레이·스토어·coordinator.
// IPC와 리소스 조회만 대역. "기준점을 옮긴 뒤 자세를 열어 캔버스에서 끌면
// 제자리로 돌아온다"는 실기 보고를 그대로 재현한다
const runtime = vi.hoisted(() => {
  const resolvers: Array<(result: EditorCommitResult) => void> = [];
  let committedListener: ((event: EditorCommittedV1) => void) | null = null;
  const commit = vi.fn(
    (_request: EditorCommitRequest) =>
      new Promise<EditorCommitResult>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const get = vi.fn();
  const onCommitted = vi.fn((listener: (event: EditorCommittedV1) => void) => {
    committedListener = listener;
    return Object.assign(() => {}, { ready: Promise.resolve() });
  });
  return {
    commit,
    get,
    onCommitted,
    emitCommittedForCall: (index: number, revision: number) => {
      const request = commit.mock.calls[index]?.[0];
      if (!request?.changes) throw new Error('Missing commit request');
      committedListener?.({
        schemaVersion: 1,
        revision,
        mutationId: request.mutationId,
        changedFields: ['spritePositions'],
        patch: { ...request.changes, schemaVersion: 1 },
        gestureId: request.gestureId,
        gestureIds: request.gestureId ? [request.gestureId] : [],
      });
    },
    // 케이스 사이에 남은 resolver를 비운다 - 이전 케이스의 보류 저장이 다음 케이스의
    // resolveNext를 가로채면 직렬 큐가 멈춘 것처럼 보인다
    reset: () => {
      resolvers.length = 0;
    },
    resolveNext: (revision: number) => {
      const resolve = resolvers.shift();
      if (!resolve) throw new Error('Missing commit resolver');
      resolve({ revision, changedFields: ['spritePositions'] });
    },
    resolveAll: () => {
      let revision = 1;
      while (resolvers.length > 0) {
        resolvers.shift()!({
          revision: revision++,
          changedFields: ['spritePositions'],
        });
      }
    },
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
vi.mock('@api/modules/resourceApi', () => ({
  imageApi: { load: vi.fn(() => Promise.resolve({ success: false })) },
}));
vi.mock('@utils/core/assetProbe', () => ({
  canDecodeImage: vi.fn(() => Promise.resolve(true)),
  probeImageSize: vi.fn(() => Promise.resolve({ width: 64, height: 32 })),
  canLoadFont: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));
vi.mock('@components/main/Grid/PropertiesPanel/PickerSurface', () => ({
  default: ({
    open,
    children,
    ariaLabel,
  }: {
    open: boolean;
    children: React.ReactNode;
    ariaLabel: string;
  }) =>
    open ? (
      <div data-testid="pose-popup" aria-label={ariaLabel}>
        {children}
      </div>
    ) : null,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

// NumberInput은 네이티브 value setter + input 이벤트로 타이핑을 흉내 낸다
const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const spriteFixture = (): CanonicalReactiveSpritePosition => ({
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
      poseId: POSE_ID,
      triggers: [KEY_ID_A],
      transform: { x: 0, y: 0, rotation: 8.8, scale: 1 },
      imageOverride: null,
      imageOverrideMetrics: null,
    },
  ],
  transitionMs: 0,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  referenceNaturalSize: null,
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
  const [handles, panel, overlay, spriteStore, coordinator, dragSession] =
    await Promise.all([
      import('./SpriteCanvasHandles'),
      import('@components/main/Grid/PropertiesPanel/single/SingleSpritePanel'),
      import('@src/renderer/editor/runtime/previewOverlay'),
      import('@stores/data/useSpriteStore'),
      import('@src/renderer/editor/runtime/editorStateCoordinator'),
      import('@hooks/Grid/dragSession'),
    ]);
  return {
    SpriteCanvasHandles: handles.default,
    SingleSpritePanel: panel.SingleSpritePanel,
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

describe('자세 편집 세션 통합 (패널 + 캔버스 핸들)', () => {
  let harness: Harness;
  let container: HTMLDivElement;
  let root: Root;
  let errors: string[];
  const selected: SelectedElement[] = [{ type: 'sprite', id: SPRITE_ID }];

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
    const position = spritePositions['4key']?.find(
      (candidate) => candidate.id === SPRITE_ID,
    );
    if (!position) return null;
    return (
      <>
        <harness.SingleSpritePanel
          setPanelElement={vi.fn()}
          panelElement={container}
          singleSpritePosition={position as never}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>() as never}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          singleScrollRefFor={() => vi.fn()}
          t={((key: string) => key) as never}
        />
        <harness.SpriteCanvasHandles
          spritePositions={spritePositions}
          selectedElements={selected}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
        />
      </>
    );
  };

  const render = () => act(() => root.render(<Host />));
  const pivotHandle = () =>
    container.querySelector<HTMLElement>('[data-sprite-pivot-handle="true"]')!;
  const poseFrame = () =>
    container.querySelector<SVGPolygonElement>(
      '[data-sprite-pose-frame="true"]',
    );
  const poseRows = () =>
    [...container.querySelectorAll<HTMLElement>('[role="button"]')].filter(
      (row) =>
        row.textContent?.startsWith('propertiesPanel.spritePose ') ?? false,
    );
  const canonicalSprite = () =>
    harness.useSpriteStore.getState().positions['4key'][0];
  const pointer = (
    type: string,
    target: EventTarget,
    clientX: number,
    clientY: number,
    init: { buttons?: number; ctrlKey?: boolean } = {},
  ) =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
          clientX,
          clientY,
          pointerId: 1,
          ctrlKey: init.ctrlKey ?? false,
        }),
      );
    });
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  const framePoints = () =>
    poseFrame()!
      .getAttribute('points')!
      .split(' ')
      .map((pair) => pair.split(',').map(Number));
  const pivotCenter = () => ({
    x: Number.parseFloat(pivotHandle().style.left) + 13,
    y: Number.parseFloat(pivotHandle().style.top) + 13,
  });

  beforeEach(async () => {
    vi.resetModules();
    runtime.commit.mockClear();
    runtime.get.mockReset();
    runtime.reset();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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
    vi.restoreAllMocks();
  });

  it('기준점을 옮긴 뒤 자세를 열어 캔버스에서 끌면 자세가 새 자리에 남는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    // 1. 기준점을 중앙 (100, 75)에서 (140, 75)로 - 스냅 해제
    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 140, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 140, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    expect(canonicalSprite().pivot.x).toBeCloseTo(0.7, 9);
    const baseAxisAfter = pivotCenter();
    // 기본 선택 표식은 1px 선택 테두리 프레임에 놓여 x가 0.4px 바깥이다
    expect(baseAxisAfter.x).toBeCloseTo(140.4, 6);
    expect(baseAxisAfter.y).toBeCloseTo(75, 6);
    const linkedTransform = canonicalSprite().poses[0].transform;
    // 연결 상태는 이동값을 유지해 기준점 화면 좌표가 기본 축을 따라간다
    expect(linkedTransform).toEqual({
      x: 0,
      y: 0,
      rotation: 8.8,
      scale: 1,
    });
    runtime.resolveAll();
    await settle();

    // 2. 자세 행 클릭 → 팝업·세션
    expect(poseRows().length).toBe(1);
    act(() => poseRows()[0].click());
    await settle();
    expect(poseFrame()).not.toBeNull();
    const linkedAxis = pivotCenter();
    expect(linkedAxis.x).toBeCloseTo(140, 6);
    expect(linkedAxis.y).toBeCloseTo(baseAxisAfter.y, 6);
    const before = framePoints();

    // 3. 자세 프레임 본체를 (60, 60)에서 (90, 80)으로 끌기
    pointer('pointerdown', poseFrame()!, 60, 60);
    // 일부 WebView 합성 입력은 활성 드래그에서도 buttons를 0으로 전달한다
    pointer('pointermove', window, 90, 80, { buttons: 0 });
    await settle();
    const during = framePoints();
    expect(during[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(during[0][1] - before[0][1]).toBeCloseTo(20, 6);

    pointer('pointerup', window, 90, 80);
    await settle();
    // 커밋이 나갔고 canonical 자세 이동값이 30, 20만큼 늘었다
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    const moved = canonicalSprite().poses[0].transform;
    expect(moved.x - linkedTransform.x).toBeCloseTo(30, 6);
    expect(moved.y - linkedTransform.y).toBeCloseTo(20, 6);
    // 프레임도 새 자리에 남는다 (제자리 복귀 없음)
    const after = framePoints();
    expect(after[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(after[0][1] - before[0][1]).toBeCloseTo(20, 6);

    runtime.resolveAll();
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(
      canonicalSprite().poses[0].transform.x - linkedTransform.x,
    ).toBeCloseTo(30, 6);
    expect(errors.filter((line) => /Failed|failed/.test(line))).toEqual([]);
  });

  it('pointerup 없이 mouseup만 와도 자세 이동을 저장하고 드래그를 끝낸다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    act(() => poseRows()[0].click());
    await settle();
    const before = framePoints();

    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 90, 80);
    await settle();
    act(() => {
      window.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
        }),
      );
    });
    await settle();

    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(canonicalSprite().poses[0].transform).toEqual(
      expect.objectContaining({ x: 30, y: 20 }),
    );
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);

    // 해제 후 마우스만 옮겨도 닫힌 드래그가 다시 움직이지 않음
    pointer('pointermove', window, 140, 120, { buttons: 0 });
    await settle();
    expect(canonicalSprite().poses[0].transform).toEqual(
      expect.objectContaining({ x: 30, y: 20 }),
    );
    expect(runtime.commit).toHaveBeenCalledOnce();

    runtime.resolveAll();
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);
    expect(errors.filter((line) => /Failed|failed/.test(line))).toEqual([]);
  });

  it('눌린 move 뒤 buttons 0 move로 끝나도 자세 이동을 저장한다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    act(() => poseRows()[0].click());
    await settle();
    const before = framePoints();
    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 80, 70, { buttons: 1 });
    await settle();
    pointer('pointermove', window, 90, 80, { buttons: 0 });
    await settle();

    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(canonicalSprite().poses[0].transform).toEqual(
      expect.objectContaining({ x: 30, y: 20 }),
    );
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);

    pointer('pointermove', window, 140, 120, { buttons: 0 });
    await settle();
    expect(runtime.commit).toHaveBeenCalledOnce();
    runtime.resolveAll();
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);
  });

  it('이전 로컬 프리뷰가 남아 있어도 새 자세 이동 커밋을 다시 가리지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    const stalePose = {
      ...canonicalSprite().poses[0],
      transform: {
        ...canonicalSprite().poses[0].transform,
        x: 20,
      },
    };
    act(() => {
      harness.previewOverlay.applyLocalPatchByIds(
        '11111111-1111-4111-8111-111111111111',
        '4key',
        [SPRITE_ID],
        { poses: [stalePose] },
        'spritePosition',
      );
    });
    await settle();

    act(() => poseRows()[0].click());
    await settle();
    const before = framePoints();
    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 90, 80);
    await settle();
    pointer('pointerup', window, 90, 80);
    await settle();

    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(canonicalSprite().poses[0].transform).toEqual(
      expect.objectContaining({ x: 50, y: 20 }),
    );
    runtime.resolveAll();
    await settle();

    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);
    expect(canonicalSprite().poses[0].transform).toEqual(
      expect.objectContaining({ x: 50, y: 20 }),
    );
    expect(errors.filter((line) => /Failed|failed/.test(line))).toEqual([]);
  });

  it('기준점 저장 응답을 기다리지 않고 자세를 움직여도 새 자리에 남는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    act(() => poseRows()[0].click());
    await settle();
    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 140, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 140, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    const compensated = canonicalSprite().poses[0].transform;
    const before = framePoints();

    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 90, 80, { buttons: 0 });
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    pointer('pointerup', window, 90, 80);
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    runtime.resolveAll();
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    expect(canonicalSprite().poses[0].transform.x - compensated.x).toBeCloseTo(
      30,
      6,
    );
    runtime.resolveAll();
    await settle();
    expect(canonicalSprite().poses[0].transform.x - compensated.x).toBeCloseTo(
      30,
      6,
    );
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
  });

  it('기본 기준점과 자세 기준점 저장이 차례로 대기해도 후속 자세 이동을 유지한다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 140, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 140, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    act(() => poseRows()[0].click());
    await settle();
    const beforePosePivot = framePoints();
    const posePivot = pivotCenter();
    pointer('pointerdown', pivotHandle(), posePivot.x, posePivot.y);
    pointer('pointermove', window, posePivot.x + 20, posePivot.y + 10, {
      ctrlKey: true,
    });
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    pointer('pointerup', window, posePivot.x + 20, posePivot.y + 10);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    const afterPosePivot = framePoints();
    afterPosePivot.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(beforePosePivot[index][0], 6);
      expect(point[1]).toBeCloseTo(beforePosePivot[index][1], 6);
    });

    const before = framePoints();
    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 90, 80, { buttons: 0 });
    await settle();
    pointer('pointerup', window, 90, 80);
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);

    act(() => {
      runtime.emitCommittedForCall(0, 1);
      runtime.resolveNext(1);
    });
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    expect(canonicalSprite().poses[0].pivot).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    );
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);

    act(() => {
      runtime.emitCommittedForCall(1, 2);
      runtime.resolveNext(2);
    });
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(3);
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);

    act(() => {
      runtime.emitCommittedForCall(2, 3);
      runtime.resolveNext(3);
    });
    await settle();
    expect(framePoints()[0][0] - before[0][0]).toBeCloseTo(30, 6);
    expect(framePoints()[0][1] - before[0][1]).toBeCloseTo(20, 6);
    expect(errors.filter((line) => /Failed|failed/.test(line))).toEqual([]);
  });

  it('자세 이동과 독립 기준점 저장이 대기 중이어도 후속 기본 기준점 변경이 둘을 덮지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    // 1. 자세 이동 저장을 응답 대기 상태로 둔다
    act(() => poseRows()[0].click());
    await settle();
    const initialFrame = framePoints();
    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 90, 80);
    await settle();
    pointer('pointerup', window, 90, 80);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    expect(canonicalSprite().poses[0].transform).toEqual(
      expect.objectContaining({ x: 30, y: 20 }),
    );

    // 2. 첫 저장을 기다리지 않고 자세 기준점을 독립 위치로 옮긴다
    const statePivot = pivotCenter();
    pointer('pointerdown', pivotHandle(), statePivot.x, statePivot.y);
    pointer('pointermove', window, statePivot.x + 20, statePivot.y + 10, {
      ctrlKey: true,
    });
    await settle();
    pointer('pointerup', window, statePivot.x + 20, statePivot.y + 10);
    await settle();
    const beforeBasePivotFrame = framePoints();
    // 3. 팝업을 닫고 기본 기준점을 옮긴다. 앞의 두 저장은 아직 대기 중이다
    act(() => poseRows()[0].click());
    await settle();
    const basePivot = pivotCenter();
    pointer('pointerdown', pivotHandle(), basePivot.x, basePivot.y);
    pointer('pointermove', window, basePivot.x - 30, basePivot.y - 15, {
      ctrlKey: true,
    });
    await settle();
    const intendedBasePivot = { x: 0.35, y: 0.4 };

    // 첫 저장 응답이 기본 기준점 드래그 도중 도착하는 실제 순서
    act(() => {
      runtime.emitCommittedForCall(0, 1);
      runtime.resolveNext(1);
    });
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    const releasedBasePivot = pivotCenter();
    pointer('pointerup', window, basePivot.x - 30, basePivot.y - 15);
    await settle();
    // 앞선 자세 저장 때문에 기본 기준점 커밋이 아직 슬롯에 못 들어가도
    // pointerup 착지는 그대로 유지되어야 한다
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    expect(pivotCenter().x).toBeCloseTo(releasedBasePivot.x, 6);
    expect(pivotCenter().y).toBeCloseTo(releasedBasePivot.y, 6);
    act(() => {
      runtime.emitCommittedForCall(1, 2);
      runtime.resolveNext(2);
    });
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(3);
    act(() => {
      runtime.emitCommittedForCall(2, 3);
      runtime.resolveNext(3);
    });
    await settle();

    expect(canonicalSprite().pivot).toEqual(intendedBasePivot);
    expect(canonicalSprite().poses[0].pivot).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    );
    expect(canonicalSprite().poses[0].transform.x).not.toBe(0);
    expect(canonicalSprite().poses[0].transform.y).not.toBe(0);
    act(() => poseRows()[0].click());
    await settle();
    const finalFrame = framePoints();
    finalFrame.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(beforeBasePivotFrame[index][0], 6);
      expect(point[1]).toBeCloseTo(beforeBasePivotFrame[index][1], 6);
    });
    expect(finalFrame[0][0]).not.toBeCloseTo(initialFrame[0][0], 6);
    expect(finalFrame[0][1]).not.toBeCloseTo(initialFrame[0][1], 6);
    expect(errors.filter((line) => /Failed|failed/.test(line))).toEqual([]);
  });

  it('상태 기준점 연결을 끄고 다시 켜도 이미지가 제자리에 남는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    act(() => poseRows()[0].click());
    await settle();
    const toggle = container.querySelector<HTMLElement>('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const before = framePoints();

    act(() => toggle.click());
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    expect(
      runtime.commit.mock.calls[0][0].changes?.spritePositions?.['4key']?.[0]
        .poses[0].pivot,
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    framePoints().forEach((point, index) => {
      expect(point[0]).toBeCloseTo(before[index][0], 6);
      expect(point[1]).toBeCloseTo(before[index][1], 6);
    });

    act(() => {
      runtime.emitCommittedForCall(0, 1);
      runtime.resolveNext(1);
    });
    await settle();
    const linkedToggle =
      container.querySelector<HTMLElement>('[role="switch"]')!;
    act(() => linkedToggle.click());
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    expect(
      runtime.commit.mock.calls[1][0].changes?.spritePositions?.['4key']?.[0]
        .poses[0].pivot,
    ).toBeNull();
    expect(linkedToggle.getAttribute('aria-checked')).toBe('true');
    framePoints().forEach((point, index) => {
      expect(point[0]).toBeCloseTo(before[index][0], 6);
      expect(point[1]).toBeCloseTo(before[index][1], 6);
    });
  });

  it('앞선 저장이 큐를 점유해 자세 이동이 draft에만 있을 때 팝업 회전이 이동값을 덮지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    // 1. 기본 기준점 저장 - 응답을 보류해 직렬 큐를 점유한다
    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 140, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 140, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    // 2. 자세를 열고 캔버스에서 이동 - 큐가 막혀 있어 canonical엔 못 들어가고 draft에만 남는다
    act(() => poseRows()[0].click());
    await settle();
    pointer('pointerdown', poseFrame()!, 60, 60);
    pointer('pointermove', window, 90, 80);
    await settle();
    pointer('pointerup', window, 90, 80);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    expect(canonicalSprite().poses[0].transform.x).toBe(0);

    // 3. 큐가 비기 전에 팝업에서 회전만 편집
    const rotation = container.querySelector<HTMLInputElement>(
      'input[aria-label="propertiesPanel.spriteRotation"]',
    )!;
    act(() => {
      rotation.focus();
      setInputValue(rotation, '20');
    });
    act(() => rotation.blur());
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    // 4. 저장을 차례로 풀면 이동 → 회전 순으로 나가고, 회전 wire에도 이동값이 남는다
    runtime.resolveNext(1);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(2);
    runtime.resolveNext(2);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(3);
    const third = runtime.commit.mock.calls[2][0];
    const wirePose = third.changes?.spritePositions?.['4key']?.[0]?.poses?.[0];
    expect(wirePose?.transform.x).toBeCloseTo(30, 6);
    expect(wirePose?.transform.y).toBeCloseTo(20, 6);
    expect(wirePose?.transform.rotation).toBe(20);

    runtime.resolveNext(3);
    await settle();
    const final = canonicalSprite().poses[0].transform;
    expect(final.x).toBeCloseTo(30, 6);
    expect(final.y).toBeCloseTo(20, 6);
    expect(final.rotation).toBe(20);
    expect(errors.filter((line) => /Failed|failed/.test(line))).toEqual([]);
  });

  it('앞선 저장이 큐를 점유해도 기본 기준점 X 뒤 Y 입력이 서로를 덮지 않는다', async () => {
    runtime.get.mockResolvedValue({
      revision: 0,
      document: makeDocument(spriteFixture()),
    });
    await harness.editorCoordinator.start();
    render();

    // 큐 점유 - 캔버스 기준점 드래그 저장을 보류
    pointer('pointerdown', pivotHandle(), 100, 75);
    pointer('pointermove', window, 120, 75, { ctrlKey: true });
    await settle();
    pointer('pointerup', window, 120, 75);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    const typePercent = (axis: 'X' | 'Y', value: string) => {
      const input = container.querySelector<HTMLInputElement>(
        `input[aria-label="propertiesPanel.spritePivot ${axis}"]`,
      )!;
      act(() => {
        input.focus();
        setInputValue(input, value);
      });
      act(() => input.blur());
    };
    typePercent('X', '25');
    await settle();
    typePercent('Y', '80');
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    runtime.resolveNext(1);
    await settle();
    runtime.resolveNext(2);
    await settle();
    expect(runtime.commit).toHaveBeenCalledTimes(3);
    const third = runtime.commit.mock.calls[2][0];
    const wireSprite = third.changes?.spritePositions?.['4key']?.[0];
    expect(wireSprite?.pivot.x).toBeCloseTo(0.25, 9);
    expect(wireSprite?.pivot.y).toBeCloseTo(0.8, 9);
    runtime.resolveNext(3);
    await settle();
    expect(canonicalSprite().pivot.x).toBeCloseTo(0.25, 9);
    expect(canonicalSprite().pivot.y).toBeCloseTo(0.8, 9);
  });
});
