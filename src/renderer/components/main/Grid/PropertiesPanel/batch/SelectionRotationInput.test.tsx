import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalEditorDocumentV1,
  EditorCommittedV1,
  EditorCommitRequest,
  EditorCommitResult,
} from '@src/types/editor';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import {
  makeCanonicalSpritePosition,
  makeSpritePose,
} from '@utils/sprite/spriteFixtures';
import type { SelectionRotationTarget } from '@utils/core/selectionRotation';
import type { SelectionRotationFrame } from '../../handles/selectionRotationGesture';

const transport = vi.hoisted(() => {
  let resolveCommit!: (result: EditorCommitResult) => void;
  let listener: ((event: EditorCommittedV1) => void) | null = null;
  return {
    get: vi.fn(),
    commit: vi.fn(
      (_request: EditorCommitRequest) =>
        new Promise<EditorCommitResult>((resolve) => {
          resolveCommit = resolve;
        }),
    ),
    onCommitted: vi.fn((next: (event: EditorCommittedV1) => void) => {
      listener = next;
      return Object.assign(
        () => {
          listener = null;
        },
        { ready: Promise.resolve() },
      );
    }),
    resolve: (result: EditorCommitResult) => resolveCommit(result),
    emit: (event: EditorCommittedV1) => listener?.(event),
    subscribe: vi.fn(async () => 1),
    publish: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
});
vi.mock('@api/modules/editorApi', () => ({ editorApi: transport }));
vi.mock('@api/modules/previewApi', () => ({ previewApi: transport }));
vi.mock('@components/main/Grid/PropertiesPanel/index', async () => {
  const { createElement } = await import('react');
  const { NumberInput } = await import('@components/main/common/NumberInput');
  return {
    NumberInput,
    PropertyRow: ({ children }: { children: ReactNode }) =>
      createElement('div', {}, children),
  };
});

const MODE = '4key';
const FIELDS = [
  'keyPositions',
  'statPositions',
  'graphPositions',
  'knobPositions',
  'spritePositions',
] as const;
const TYPES = ['key', 'stat', 'graph', 'knob', 'sprite'] as const;
const KEY_IDS = [
  '78444669-146d-4e4b-a79e-ac35995b2fa3',
  'd3115e30-d0a5-4662-b985-138d23d1388e',
  '82cf7bb7-5157-4a49-95be-14bbe51ed9b6',
  'a0192a48-f3e6-405a-a78b-d586d36e86df',
  '6a4c3fdc-867f-40e2-8af6-efb92322194b',
  'cc1de0e9-1bd8-49d9-ad53-5e5ca71eb681',
  '8933d814-8da1-434d-a848-f21ad5fc34a8',
  '947e2792-58b7-4883-b7f9-6ca97418a1c9',
];

// 저장 시 두 좌표에서 1 ULP 차이가 발생했던 실제 혼합 선택의 기하
const initialDocument = (): CanonicalEditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { [MODE]: ['A', 'D', 'W', 'E', 'R', 'T', 'S', 'F'] },
  keyPositions: {
    [MODE]: [
      [270, 168.75, 0],
      [416.25, 168.75, 0],
      [270, 120, 25],
      [318.75, 120, 0],
      [367.5, 120, 0],
      [416.25, 120, 0],
      [318.75, 168.75, 0],
      [367.5, 168.75, 0],
    ].map(([dx, dy, rotation], index) => ({
      ...createDefaultKeyPosition(dx, dy),
      id: KEY_IDS[index],
      width: 45,
      height: 45,
      rotation,
    })),
  },
  statPositions: {
    [MODE]: [
      {
        ...createDefaultKeyPosition(270, 217.5),
        id: '5c25bd15-6eea-4626-8271-b88d6eefb2b1',
        width: 93.75,
        height: 18.75,
        rotation: 15,
        statType: 'kps',
      },
      {
        ...createDefaultKeyPosition(367.5, 217.5),
        id: 'c6ac524c-7812-4ac9-9409-e904b62e8b80',
        width: 93.75,
        height: 18.75,
        rotation: 0,
        statType: 'total',
      },
    ],
  },
  graphPositions: {
    [MODE]: [
      {
        ...createDefaultKeyPosition(206.25, 232.5),
        id: 'dbcb3015-e149-442d-820f-65fc193e3bb2',
        width: 90,
        height: 45,
        rotation: -30,
        statType: 'kps',
        graphType: 'bar',
        graphSpeed: 1000,
        graphColor: '#86EFAC',
      },
    ],
  },
  knobPositions: {
    [MODE]: [
      {
        ...createDefaultKeyPosition(120, 157.5),
        id: 'de18be4f-188d-42e1-acce-91bde017056b',
        width: 45,
        height: 45,
        rotation: 10,
        axisId: '',
        sensitivity: 1,
        reverse: true,
      },
    ],
  },
  spritePositions: {
    [MODE]: [
      makeCanonicalSpritePosition({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        dx: 123.75,
        dy: 243.75,
        width: 60,
        height: 60,
        rotation: 170,
        pivot: { x: 0.25, y: 0.75 },
        idleTransform: { rotation: 170, scale: 1, x: 15, y: 0 },
        baseImage: 'sprite.png',
        referenceNaturalSize: { source: 'sprite.png', width: 256, height: 256 },
        poses: [
          makeSpritePose({
            poseId: '11111111-1111-4111-8111-111111111111',
            triggers: [KEY_IDS[2]],
            transform: { rotation: -170, scale: 1.2, x: 30, y: -10 },
          }),
        ],
      }),
    ],
  },
  layerGroups: {},
});

const loadHarness = async () => {
  const [
    react,
    dom,
    state,
    gesture,
    preview,
    geometry,
    frame,
    keys,
    selection,
    reference,
  ] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('@src/renderer/editor/runtime/editorStateCoordinator'),
    import('@src/renderer/editor/runtime/editGestureController'),
    import('@src/renderer/editor/runtime/previewOverlay'),
    import('@utils/core/selectionRotation'),
    import('@hooks/Grid/useSelectionRotationFrame'),
    import('@stores/data/useKeyStore'),
    import('@stores/grid/useGridSelectionStore'),
    import('@stores/grid/useSelectionRotationStore'),
  ]);
  const [input, boundary, scope, pending] = await Promise.all([
    import('./SelectionRotationInput'),
    import('../EditSessionBoundary'),
    import('@contexts/EditSessionScope'),
    import('@hooks/pendingOptimisticCommits'),
  ]);
  return {
    ...react,
    ...dom,
    ...state,
    ...gesture,
    ...preview,
    ...geometry,
    ...frame,
    ...keys,
    ...selection,
    ...reference,
    ...scope,
    ...pending,
    EditSessionBoundary: boundary.default,
    SelectionRotationInput: input.default,
  };
};
type Harness = Awaited<ReturnType<typeof loadHarness>>;
let harness: Harness;
let host: HTMLDivElement;
let root: Root;
let currentFrame: SelectionRotationFrame | null;
let targets: SelectionRotationTarget[];
let inputTree: ReactNode;

const requestAt = async (count: number) => {
  await harness.act(async () => {
    await vi.waitFor(() =>
      expect(transport.commit).toHaveBeenCalledTimes(count),
    );
  });
  return transport.commit.mock.calls[count - 1][0];
};
const enterRotation = async (rotation: number) => {
  const input = host.querySelector('input')!;
  harness.act(() => input.focus());
  harness.act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, String(rotation));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await harness.act(async () => {
    await vi.waitFor(() => expect(currentFrame?.rotation).toBe(rotation));
  });
  harness.act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
};

const previewRotation = (rotation: number) => {
  const input = host.querySelector('input')!;
  harness.act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, String(rotation));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    harness.drainPendingOptimisticCommits();
  });
  return input;
};

const applyExternalPositions = async (
  revision: number,
  keyPositions: CanonicalEditorDocumentV1['keyPositions'],
) => {
  await harness.act(async () => {
    transport.emit({
      schemaVersion: 1,
      revision,
      mutationId: `external-${revision}`,
      origin: 'overlay',
      changedFields: ['keyPositions'],
      patch: { schemaVersion: 1, keyPositions },
    });
    await vi.waitFor(() =>
      expect(harness.editorCoordinator.getState().revision).toBe(revision),
    );
  });
};

describe('혼합 선택 숫자 회전의 네이티브 저장 정산', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    window.__dmn_window_type = 'main';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const document = initialDocument();
    targets = FIELDS.flatMap((field, index) =>
      document[field][MODE].map(({ id }) => ({ type: TYPES[index], id })),
    );
    transport.get.mockResolvedValue({ revision: 0, document });
    harness = await loadHarness();
    harness.useKeyStore.setState({ selectedKeyType: MODE });
    harness.useGridSelectionStore.setState({ selectedElements: targets });
    harness.useSelectionRotationStore.setState({
      selectionKey: null,
      referenceRotation: 0,
    });
    await harness.editorCoordinator.start();
    host = window.document.createElement('div');
    window.document.body.appendChild(host);
    root = harness.createRoot(host);
    const { createElement, useLayoutEffect } = harness;
    const TestInput = () => {
      const frame = harness.useSelectionRotationFrame();
      useLayoutEffect(() => {
        currentFrame = frame;
      }, [frame]);
      return createElement(harness.EditSessionScope, {
        children: createElement(harness.EditSessionBoundary, {
          children: createElement(harness.SelectionRotationInput, {
            label: '회전',
          }),
        }),
      });
    };
    inputTree = createElement(TestInput);
    harness.act(() => root.render(inputTree));
  });
  afterEach(() => {
    harness.act(() => {
      root.unmount();
      harness.editGestureController.cancel();
      harness.previewOverlay.clearAll();
    });
    host.remove();
    harness.editorCoordinator.stop();
    vi.restoreAllMocks();
    delete window.__dmn_window_type;
  });

  it.each(['before-ack', 'after-ack'] as const)(
    '정확 왕복 이벤트가 %s에 도착해도 45° 뒤 90°를 저장하고 표시한다',
    async (order) => {
      expect(targets).toHaveLength(13);
      expect(currentFrame?.rotation).toBe(0);
      await enterRotation(45);
      const first = await requestAt(1);
      expect(first.changes!.keyPositions![MODE][4].dy).toBe(209.77425768631718);
      expect(first.changes!.spritePositions![MODE][0].dx).toBe(
        114.55722993194729,
      );
      const event: EditorCommittedV1 = {
        schemaVersion: 1,
        revision: 1,
        mutationId: first.mutationId,
        origin: 'main',
        gestureId: first.gestureId,
        changedFields: [...FIELDS],
        patch: JSON.parse(JSON.stringify(first.changes)),
      };
      if (order === 'before-ack')
        await harness.act(async () => {
          transport.emit(event);
        });
      await harness.act(async () => {
        transport.resolve({ revision: 1, changedFields: [...FIELDS] });
      });
      if (order === 'after-ack')
        await harness.act(async () => {
          transport.emit(event);
        });
      await harness.act(async () => {
        await vi.waitFor(() =>
          expect(harness.editorCoordinator.getState()).toMatchObject({
            revision: 1,
            phase: 'idle',
          }),
        );
      });
      expect(harness.editGestureController.activeGestureId()).toBeNull();
      const acknowledged = harness.editorCoordinator.getState().lastAck!;
      const canonicalSnapshot = harness.createSelectionRotationSnapshot(
        acknowledged,
        targets,
        MODE,
      )!;
      expect(currentFrame!.snapshot.geometrySignature).toBe(
        canonicalSnapshot.geometrySignature,
      );
      const expected = harness.rotateSelection(
        {
          ...canonicalSnapshot,
          center: {
            x: currentFrame!.bounds.x + currentFrame!.bounds.width / 2,
            y: currentFrame!.bounds.y + currentFrame!.bounds.height / 2,
          },
        },
        45,
      )!;

      await enterRotation(90);
      const second = await requestAt(2);
      for (const { type, id, patch } of expected) {
        const field = FIELDS[TYPES.indexOf(type)];
        expect(
          second.changes![field]![MODE].find((position) => position.id === id),
        ).toMatchObject(patch);
      }
      await harness.act(async () => {
        transport.resolve({ revision: 2, changedFields: [...FIELDS] });
      });
      await harness.act(async () => {
        await vi.waitFor(() =>
          expect(harness.editorCoordinator.getState()).toMatchObject({
            revision: 2,
            phase: 'idle',
          }),
        );
      });
      expect(currentFrame!.rotation).toBe(90);
      expect(host.querySelector('input')!.value).toBe('90°');
      expect(
        harness.captureEditorDocument().spritePositions[MODE][0].poses,
      ).toEqual(initialDocument().spritePositions[MODE][0].poses);
    },
  );

  it('외부 변경으로 취소된 세션은 첫 거절 뒤 최신 틀로 입력을 재개한다', async () => {
    const input = previewRotation(45);
    expect(currentFrame?.rotation).toBe(45);
    const external = structuredClone(initialDocument().keyPositions);
    external[MODE][0].dx += 20;
    harness.act(() => harness.editGestureController.cancel());
    await applyExternalPositions(1, external);

    previewRotation(60);
    expect(currentFrame?.rotation).toBe(0);
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    previewRotation(75);
    expect(currentFrame?.rotation).toBe(75);
    harness.act(() => input.blur());
    const request = await requestAt(1);
    expect(request.baseRevision).toBe(1);
    expect(request.changes!.keyPositions![MODE][0].rotation).toBe(75);
    await harness.act(async () => {
      transport.resolve({ revision: 2, changedFields: [...FIELDS] });
      await vi.waitFor(() =>
        expect(harness.editorCoordinator.getState()).toMatchObject({
          revision: 2,
          phase: 'idle',
        }),
      );
    });
    expect(input.value).toBe('75°');
  });

  it('첫 프리뷰가 좌표 한계로 거절된 뒤 같은 선택의 외부 이동을 받아 재시도한다', async () => {
    const edge = structuredClone(initialDocument().keyPositions);
    edge[MODE][0].dx = 32768;
    edge[MODE][0].dy = 32768;
    await applyExternalPositions(1, edge);
    previewRotation(45);
    expect(currentFrame?.rotation).toBe(0);
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    expect(transport.commit).not.toHaveBeenCalled();

    await applyExternalPositions(2, initialDocument().keyPositions);
    const input = previewRotation(60);
    expect(currentFrame?.rotation).toBe(60);
    harness.act(() => input.blur());
    const request = await requestAt(1);
    expect(request.baseRevision).toBe(2);
    expect(request.changes!.keyPositions![MODE][0].rotation).toBe(60);
    await harness.act(async () => {
      transport.resolve({ revision: 3, changedFields: [...FIELDS] });
      await vi.waitFor(() =>
        expect(harness.editorCoordinator.getState()).toMatchObject({
          revision: 3,
          phase: 'idle',
        }),
      );
    });
  });

  it('선택 변경은 기존 패널 경계에서 draft를 버리고 늦은 blur도 저장하지 않는다', () => {
    const input = previewRotation(45);
    harness.act(() =>
      harness.useGridSelectionStore.setState({
        selectedElements: targets.slice(0, 2),
      }),
    );
    expect(input.isConnected).toBe(false);
    harness.act(() => input.blur());
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    expect(transport.commit).not.toHaveBeenCalled();
    expect(harness.captureEditorDocument()).toEqual(initialDocument());
  });

  it.each(['selection', 'mode', 'panelClose'] as const)(
    '%s 전환은 첫 프레임을 기다리던 프리뷰가 입력 수명 뒤 되살아나는 것을 막는다',
    (boundary) => {
      const input = host.querySelector('input')!;
      harness.act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, '45');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(harness.editGestureController.activeGestureId()).toBeNull();
      harness.act(() => {
        if (boundary === 'selection') {
          harness.useGridSelectionStore.setState({
            selectedElements: targets.slice(0, 2),
          });
        } else if (boundary === 'mode') {
          harness.useKeyStore.setState({ selectedKeyType: '5key' });
        } else {
          root.render(null);
        }
      });
      expect(input.isConnected).toBe(false);
      harness.act(() => {
        input.blur();
        harness.drainPendingOptimisticCommits();
      });
      expect(harness.editGestureController.activeGestureId()).toBeNull();
      expect(
        harness.composePreviewPositions(
          'keyPosition',
          harness.captureEditorDocument().keyPositions,
        ),
      ).toEqual(initialDocument().keyPositions);
      expect(transport.commit).not.toHaveBeenCalled();
      expect(harness.captureEditorDocument()).toEqual(initialDocument());
    },
  );

  it('StrictMode 수명 재설치 뒤 취소와 새 회전 저장이 모두 동작한다', async () => {
    harness.act(() =>
      root.render(harness.createElement(harness.StrictMode, {}, inputTree)),
    );
    const input = previewRotation(45);
    expect(currentFrame?.rotation).toBe(45);
    harness.act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      ),
    );
    expect(currentFrame?.rotation).toBe(0);
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    previewRotation(60);
    expect(currentFrame?.rotation).toBe(60);
    harness.act(() => input.blur());
    const request = await requestAt(1);
    expect(request.changes!.keyPositions![MODE][0].rotation).toBe(60);
    await harness.act(async () => {
      transport.resolve({ revision: 1, changedFields: [...FIELDS] });
      await vi.waitFor(() =>
        expect(harness.editorCoordinator.getState()).toMatchObject({
          revision: 1,
          phase: 'idle',
        }),
      );
    });
  });
});
