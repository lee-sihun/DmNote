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
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const SPRITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const POSE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// 실제 팝업 바깥 클릭과 캔버스 이미지까지 포함해 자세 프리뷰 종료와 저장값 유지를 구분
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
class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

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
  useInlineStyles: true,
  baseImage:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yhQAAAABJRU5ErkJggg==',
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [
    {
      poseId: POSE_ID,
      triggers: [KEY_ID_A],
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
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
  keys: { '4key': ['A'] },
  keyPositions: {
    '4key': [{ ...createDefaultKeyPosition(), id: KEY_ID_A }],
  },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: { '4key': [sprite] },
  layerGroups: {},
});

const loadHarness = async () => {
  const [
    handles,
    panel,
    overlay,
    spriteStore,
    coordinator,
    dragSession,
    spriteItem,
    editPreview,
  ] = await Promise.all([
    import('./SpriteCanvasHandles'),
    import('@components/main/Grid/PropertiesPanel/single/SingleSpritePanel'),
    import('@src/renderer/editor/runtime/previewOverlay'),
    import('@stores/data/useSpriteStore'),
    import('@src/renderer/editor/runtime/editorStateCoordinator'),
    import('@hooks/Grid/dragSession'),
    import('../layers/SpriteItem'),
    import('@stores/grid/useSpriteEditPreviewStore'),
  ]);
  return {
    SpriteCanvasHandles: handles.default,
    SpriteItem: spriteItem.default,
    useSpriteEditPreviewStore: editPreview.useSpriteEditPreviewStore,
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

describe('자세 핸들 저장 후 실제 팝업 닫기와 재개방', () => {
  let harness: Harness;
  let container: HTMLDivElement;
  let root: Root;
  let errors: string[];
  const selected: SelectedElement[] = [{ type: 'sprite', id: SPRITE_ID }];

  const Host = ({ isSelected = true }: { isSelected?: boolean }) => {
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
        <div data-testid="grid-background" />
        <harness.SpriteItem
          index={0}
          elementId={SPRITE_ID}
          position={position}
          onPositionChange={() => {}}
          isSelected={isSelected}
          activeTool="move"
        />
        {isSelected ? (
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
        ) : null}
        <harness.SpriteCanvasHandles
          spritePositions={spritePositions}
          selectedElements={isSelected ? selected : []}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
        />
      </>
    );
  };

  const render = (isSelected = true) =>
    act(() => root.render(<Host isSelected={isSelected} />));
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
      await new Promise((resolve) => setTimeout(resolve, 20));
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

  const imageTransform = () =>
    container.querySelector<HTMLImageElement>(
      '[data-sprite-element] img:not([data-sprite-idle-ghost])',
    )!.style.transform;

  const elementCenter = (element: HTMLElement) => ({
    x:
      Number.parseFloat(element.style.left) +
      Number.parseFloat(element.style.width) / 2,
    y:
      Number.parseFloat(element.style.top) +
      Number.parseFloat(element.style.height) / 2,
  });

  it.each(
    (['scale', 'move', 'rotate', 'pivot'] as const).flatMap((kind) =>
      (['popup', 'selection'] as const).flatMap((closeBy) =>
        [false, true].map((invalidSibling) => ({
          kind,
          closeBy,
          invalidSibling,
        })),
      ),
    ),
  )(
    '$kind 종료 후 $closeBy 닫힘과 재개방은 저장 응답 전후 자세를 유지한다 (무효 형제: $invalidSibling)',
    async ({ kind, closeBy, invalidSibling }) => {
      runtime.get.mockResolvedValue({
        revision: 0,
        document: makeDocument(spriteFixture()),
      });
      await harness.editorCoordinator.start();
      render();
      const idleImageTransform = imageTransform();
      expect(idleImageTransform).toContain('scale(1)');
      if (invalidSibling) {
        const addButton = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((button) =>
          button.textContent?.includes('propertiesPanel.spriteAddPose'),
        )!;
        act(() => addButton.click());
        await settle();
        expect(poseRows()).toHaveLength(2);
        expect(canonicalSprite().poses).toHaveLength(1);
        expect(
          harness.useSpriteEditPreviewStore.getState().preview?.fallbackPose
            .triggers,
        ).toEqual([]);
        expect(runtime.commit).not.toHaveBeenCalled();
      }
      act(() => poseRows()[0].click());
      await settle();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(poseFrame()).not.toBeNull();

      const beforeFrame = framePoints();
      const axis = pivotCenter();
      let target: Element;
      let from: { x: number; y: number };
      let to: { x: number; y: number };
      if (kind === 'move') {
        target = poseFrame()!;
        from = { x: 60, y: 60 };
        to = { x: 90, y: 80 };
      } else if (kind === 'pivot') {
        target = pivotHandle();
        from = axis;
        to = { x: axis.x + 20, y: axis.y + 10 };
      } else {
        const knob = container.querySelector<HTMLElement>(
          kind === 'scale'
            ? '[data-sprite-scale-knob]'
            : '[data-sprite-rotate-knob]',
        )!;
        target = knob;
        from = elementCenter(knob);
        to =
          kind === 'scale'
            ? {
                x: axis.x + (from.x - axis.x) / 2,
                y: axis.y + (from.y - axis.y) / 2,
              }
            : { x: axis.x - (from.y - axis.y), y: axis.y + (from.x - axis.x) };
      }
      pointer('pointerdown', target, from.x, from.y);
      pointer('pointermove', window, to.x, to.y, { ctrlKey: true });
      await settle();
      expect(poseFrame()).not.toBeNull();
      expect(runtime.commit).not.toHaveBeenCalled();
      const duringImageTransform = imageTransform();
      pointer('pointerup', window, to.x, to.y);
      await settle();

      expect(runtime.commit).toHaveBeenCalledTimes(1);
      expect(canonicalSprite().poses).toHaveLength(1);
      expect(poseRows()).toHaveLength(invalidSibling ? 2 : 1);
      const savedPose = structuredClone(canonicalSprite().poses[0]);
      const savedFrame = framePoints();
      const savedImageTransform = imageTransform();
      if (kind !== 'pivot') {
        expect(savedImageTransform).toBe(duringImageTransform);
      }
      expect(
        runtime.commit.mock.calls[0][0].changes?.spritePositions?.['4key']?.[0]
          .poses[0],
      ).toEqual(savedPose);
      if (kind === 'scale') {
        expect(savedPose.transform.scale).toBeCloseTo(0.5, 9);
        expect(savedImageTransform).toContain('scale(0.5)');
      } else if (kind === 'move') {
        expect(savedPose.transform).toMatchObject({ x: 30, y: 20 });
      } else if (kind === 'rotate') {
        expect(savedPose.transform.rotation).toBeCloseTo(90, 9);
      } else {
        expect(savedPose.pivot).not.toBeNull();
        expect(savedPose.pivot).not.toEqual({ x: 0.5, y: 0.5 });
        savedFrame.forEach((point, index) => {
          expect(point[0]).toBeCloseTo(beforeFrame[index][0], 6);
          expect(point[1]).toBeCloseTo(beforeFrame[index][1], 6);
        });
      }

      // 실제 FloatingPopup의 문서 capture 리스너가 바깥 클릭으로 팝업을 닫는다
      const background = container.querySelector<HTMLElement>(
        '[data-testid="grid-background"]',
      )!;
      pointer('pointerdown', background, 600, 400);
      pointer('pointerup', background, 600, 400);
      await settle();
      expect(poseFrame()).toBeNull();
      expect(harness.useSpriteEditPreviewStore.getState().preview).toBeNull();
      expect(imageTransform()).toBe(idleImageTransform);
      expect(canonicalSprite().poses[0]).toEqual(savedPose);
      expect(poseRows()).toHaveLength(invalidSibling ? 2 : 1);

      if (closeBy === 'selection') {
        render(false);
        await settle();
        expect(poseRows()).toHaveLength(0);
        expect(imageTransform()).toBe(idleImageTransform);
        render();
        await settle();
      }
      act(() => poseRows()[0].click());
      await settle();
      expect(framePoints()).toEqual(savedFrame);
      expect(imageTransform()).toBe(savedImageTransform);
      if (kind === 'scale') {
        const scaleInput = document.querySelector<HTMLInputElement>(
          'input[aria-label="propertiesPanel.spriteScale"]',
        );
        expect(Number.parseFloat(scaleInput!.value)).toBe(50);
      }

      // 재개방 뒤 늦게 도착한 저장 이벤트와 응답도 현재 자세를 되돌리지 않는다
      act(() => {
        runtime.emitCommittedForCall(0, 1);
        runtime.resolveNext(1);
      });
      await settle();
      expect(canonicalSprite().poses[0]).toEqual(savedPose);
      expect(framePoints()).toEqual(savedFrame);
      expect(imageTransform()).toBe(savedImageTransform);
      expect(runtime.commit).toHaveBeenCalledTimes(1);
      expect(canonicalSprite().poses).toHaveLength(1);
      expect(poseRows()).toHaveLength(
        invalidSibling && closeBy === 'popup' ? 2 : 1,
      );
      expect(errors).toEqual([]);
    },
  );
});
