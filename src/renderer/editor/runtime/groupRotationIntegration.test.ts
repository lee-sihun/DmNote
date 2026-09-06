import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultKeyPosition } from '../model/keys';
import type {
  CanonicalEditorDocumentV1,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorField,
  EditorOpResultV1,
} from '@src/types/editor';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

const runtime = vi.hoisted(() => {
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

vi.mock('@api/modules/editor/editorApi', () => ({ editorApi: runtime }));
vi.mock('@api/modules/editor/previewApi', () => ({ previewApi: runtime }));

const MODE = '4key';
const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
] as const;
const OTHER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TYPES = ['key', 'stat', 'graph', 'knob'] as const;
const FIELDS: EditorField[] = [
  'keyPositions',
  'statPositions',
  'graphPositions',
  'knobPositions',
];
const selected: SelectedElement[] = TYPES.map((type, index) => ({
  type,
  id: IDS[index],
  index: 0,
}));

const makeDocument = (): CanonicalEditorDocumentV1 => {
  const positions = [45, -30, 180, -180].map((rotation, index) => ({
    ...createDefaultKeyPosition(index * 100, 20),
    id: IDS[index],
    width: 40,
    height: 20,
    rotation,
  }));
  return {
    schemaVersion: 1,
    keys: { [MODE]: ['A', 'Z'] },
    keyPositions: {
      [MODE]: [
        positions[0],
        { ...createDefaultKeyPosition(500, 200), id: OTHER_ID, rotation: 12 },
      ],
    },
    statPositions: { [MODE]: [{ ...positions[1], statType: 'kps' }] },
    graphPositions: {
      [MODE]: [
        {
          ...positions[2],
          statType: 'kps',
          graphType: 'line',
          graphSpeed: 1000,
          graphColor: '#FFFFFF',
        },
      ],
    },
    knobPositions: {
      [MODE]: [{ ...positions[3], axisId: '', sensitivity: 1, reverse: false }],
    },
    spritePositions: {},
    layerGroups: {},
  };
};

const members = (document: CanonicalEditorDocumentV1) => [
  document.keyPositions[MODE][0],
  document.statPositions[MODE][0],
  document.graphPositions[MODE][0],
  document.knobPositions[MODE][0],
];

const loadHarness = async () => {
  const [
    state,
    gesture,
    actions,
    selection,
    batch,
    geometry,
    resize,
    bounds,
    preview,
    keyStore,
    selectionStore,
    ticks,
  ] = await Promise.all([
    import('./coordinator/editorStateCoordinator'),
    import('./gesture/editGestureController'),
    import('@utils/grid/groupActions'),
    import('@utils/grid/groupSelection'),
    import('@components/main/Grid/PropertiesPanel/batch/batchPanelShared'),
    import('./operations/elementGeometryOps'),
    import('@components/main/Grid/handles/groupResizePlan'),
    import('@components/main/Grid/handles/groupResizeUtils'),
    import('./gesture/previewOverlay'),
    import('@stores/data/useKeyStore'),
    import('@stores/grid/useGridSelectionStore'),
    import('@stores/data/useCommittedApplyStore'),
  ]);
  return {
    ...state,
    ...gesture,
    ...actions,
    ...selection,
    ...batch,
    ...geometry,
    ...resize,
    ...bounds,
    ...preview,
    ...keyStore,
    ...selectionStore,
    ...ticks,
  };
};
type Harness = Awaited<ReturnType<typeof loadHarness>>;
let harness: Harness;

describe('그룹 회전 편집 통합', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    window.__dmn_window_type = 'main';
    runtime.get.mockResolvedValue({ revision: 0, document: makeDocument() });
    harness = await loadHarness();
    harness.useKeyStore.setState({ selectedKeyType: MODE });
    await harness.editorCoordinator.start();
  });

  afterEach(() => {
    harness.editGestureController.cancel();
    harness.editorCoordinator.stop();
    harness.previewOverlay.clearAll();
    delete window.__dmn_window_type;
  });

  const acknowledge = async (
    revision: number,
    changedFields: EditorField[],
  ) => {
    await vi.waitFor(() =>
      expect(runtime.commit).toHaveBeenCalledTimes(revision),
    );
    const request = runtime.commit.mock.calls[revision - 1][0];
    expect(request.ops).toBeDefined();
    runtime.resolve({
      revision,
      changedFields,
      opResults: request.ops!.map(
        (op): EditorOpResultV1 =>
          op.kind === 'setBounds'
            ? { status: 'applied' as const, bounds: op.bounds }
            : { status: 'applied' as const },
      ),
    });
    await vi.waitFor(() =>
      expect(harness.editorCoordinator.getState().phase).toBe('idle'),
    );
    return request;
  };

  it('혼합 회전 그룹의 생성·일괄 회전·resize·해제와 히스토리 이벤트가 서로의 값을 보존한다', async () => {
    const initial = structuredClone(harness.captureEditorDocument());
    const grouping = harness.groupSelectedElements(MODE, selected, '그룹');
    const groupRequest = await acknowledge(1, [...FIELDS, 'layerGroups']);
    await expect(grouping).resolves.toBe(true);
    expect(groupRequest.ops).toHaveLength(1);
    expect(groupRequest.ops![0].kind).toBe('setElementGroups');
    const grouped = structuredClone(harness.captureEditorDocument());
    const groupId = grouped.layerGroups[MODE][0].id;
    expect(members(grouped).map((position) => position.groupId)).toEqual(
      Array(4).fill(groupId),
    );
    expect(members(grouped).map((position) => position.rotation)).toEqual([
      45, -30, 180, -180,
    ]);

    const expanded = harness.expandGroupSelectionFromStores(selected[2], MODE);
    expect(new Set(expanded.map(({ id }) => id))).toEqual(new Set(IDS));
    harness.useGridSelectionStore.getState().setSelectedElements(expanded);
    const handlers = harness.createStylePropertyHandlers(
      TYPES.map((elementType, index) => ({ elementType, id: IDS[index] })),
      MODE,
    );
    handlers.previewStyleProperty!({ property: 'rotation', value: 90 });
    handlers.previewStyleProperty!({ property: 'rotation', value: 135 });
    expect(harness.useKeyStore.getState().positions[MODE][0].rotation).toBe(
      135,
    );
    expect(
      members(harness.captureEditorDocument()).map(({ rotation }) => rotation),
    ).toEqual([45, -30, 180, -180]);
    const gestureId = harness.editGestureController.activeGestureId();
    handlers.commitStyleProperty!({ property: 'rotation', value: 135 });
    const rotationRequest = await acknowledge(2, FIELDS);
    expect(rotationRequest.gestureId).toBe(gestureId);
    expect(rotationRequest.ops).toEqual(
      TYPES.map((elementType, index) => ({
        kind: 'patchElement',
        elementType,
        id: IDS[index],
        patch: { property: 'rotation', value: 135 },
      })),
    );
    const rotated = structuredClone(harness.captureEditorDocument());
    expect(members(rotated)).toEqual(
      members(grouped).map((position) => ({ ...position, rotation: 135 })),
    );
    expect(rotated.keyPositions[MODE][1]).toEqual(
      grouped.keyPositions[MODE][1],
    );

    const group = harness.calculateGroupBounds(
      expanded,
      rotated.keyPositions,
      rotated.statPositions,
      rotated.graphPositions,
      rotated.knobPositions,
      MODE,
      [],
      rotated.spritePositions,
    )!;
    expect(group).toMatchObject({ x: 0, y: 20, width: 340, height: 20 });
    const plan = harness.calculateGroupResizePlan({
      handle: {
        id: 'se',
        cursor: 'nwse-resize',
        x: 1,
        y: 1,
        dx: 1,
        dy: 1,
        type: 'corner',
      },
      startMouseX: 0,
      startMouseY: 0,
      pointerX: 170,
      pointerY: 20,
      zoom: 1,
      snapSize: 1,
      startGroupBounds: group,
      startElementBounds: group.elementBounds,
      minGroupWidth: 85,
      minGroupHeight: 10,
      smartSnap: { type: 'suppressed' },
    });
    const boundsIntents = new Map(
      TYPES.map((type) => [type, new Map<string, Record<string, number>>()]),
    );
    for (const { element, bounds } of plan.result.elementBounds) {
      boundsIntents
        .get(element.type as (typeof TYPES)[number])!
        .set(element.id, {
          dx: bounds.x,
          dy: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
    }
    const resize = harness.commitElementBoundsById(
      boundsIntents,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    );
    const resizeRequest = await acknowledge(3, FIELDS);
    await expect(resize).resolves.toBe(true);
    expect(resizeRequest.ops).toHaveLength(4);
    expect(resizeRequest.ops!.every((op) => op.kind === 'setBounds')).toBe(
      true,
    );
    const resized = structuredClone(harness.captureEditorDocument());
    expect(members(resized)).toEqual(
      members(rotated).map((position) => ({
        ...position,
        dx: position.dx * 1.5,
        width: 60,
        height: 40,
      })),
    );
    expect(resized.layerGroups).toEqual(grouped.layerGroups);
    expect(resized.keyPositions[MODE][1]).toEqual(
      grouped.keyPositions[MODE][1],
    );

    const ungrouping = harness.ungroupSelectedElements(MODE, expanded);
    await acknowledge(4, [...FIELDS, 'layerGroups']);
    await expect(ungrouping).resolves.toBe(true);
    const ungrouped = structuredClone(harness.captureEditorDocument());
    expect(members(ungrouped).every(({ groupId }) => groupId == null)).toBe(
      true,
    );
    expect(members(ungrouped).map(({ rotation }) => rotation)).toEqual([
      135, 135, 135, 135,
    ]);

    // 백엔드 히스토리 생성은 IPC 밖이며, 여기서는 실제 수신·스토어 복원 경로를 검증
    let revision = 4;
    const tick = harness.useCommittedApplyStore.getState().historyTick;
    for (const [origin, snapshots] of [
      ['historyUndo', [resized, rotated, grouped, initial]],
      ['historyRedo', [grouped, rotated, resized, ungrouped]],
    ] as const) {
      for (const snapshot of snapshots) {
        runtime.emit({
          schemaVersion: 1,
          revision: ++revision,
          mutationId: crypto.randomUUID(),
          origin,
          changedFields: [...FIELDS, 'layerGroups'],
          patch: {
            schemaVersion: 1,
            keyPositions: snapshot.keyPositions,
            statPositions: snapshot.statPositions,
            graphPositions: snapshot.graphPositions,
            knobPositions: snapshot.knobPositions,
            layerGroups: snapshot.layerGroups,
          },
        });
        await vi.waitFor(() =>
          expect(harness.captureEditorDocument()).toEqual(snapshot),
        );
        expect(harness.useKeyStore.getState().positions[MODE][0].rotation).toBe(
          snapshot.keyPositions[MODE][0].rotation,
        );
        expect(
          new Set(
            harness.useGridSelectionStore
              .getState()
              .selectedElements.map(({ id }) => id),
          ),
        ).toEqual(new Set(IDS));
      }
    }
    expect(harness.useCommittedApplyStore.getState().historyTick).toBe(
      tick + 8,
    );
    expect(runtime.commit).toHaveBeenCalledTimes(4);
  });

  it('서로 다른 각도의 그룹은 프리뷰 취소와 resize 후에도 원래 각도를 유지한다', async () => {
    const grouping = harness.groupSelectedElements(MODE, selected, '그룹');
    await acknowledge(1, [...FIELDS, 'layerGroups']);
    await grouping;
    const before = structuredClone(harness.captureEditorDocument());
    const handlers = harness.createStylePropertyHandlers(
      TYPES.map((elementType, index) => ({ elementType, id: IDS[index] })),
      MODE,
    );
    handlers.previewStyleProperty!({ property: 'rotation', value: -90 });
    const domains = [
      'keyPosition',
      'statPosition',
      'graphPosition',
      'knobPosition',
    ] as const;
    const collections = [
      before.keyPositions,
      before.statPositions,
      before.graphPositions,
      before.knobPositions,
    ];
    for (const [index, domain] of domains.entries()) {
      expect(
        harness.composePreviewPositions(domain, collections[index])[MODE][0]
          .rotation,
      ).toBe(-90);
    }
    harness.editGestureController.cancel();
    expect(harness.captureEditorDocument()).toEqual(before);
    expect(harness.useKeyStore.getState().positions[MODE][0].rotation).toBe(45);
    for (const [index, domain] of domains.entries()) {
      expect(
        harness.composePreviewPositions(domain, collections[index])[MODE][0]
          .rotation,
      ).toBe(members(before)[index].rotation);
    }
    expect(runtime.commit).toHaveBeenCalledTimes(1);

    const originals = members(before);
    const boundsIntents = new Map(
      TYPES.map((type, index) => [
        type,
        new Map([
          [
            IDS[index],
            {
              dx: originals[index].dx * 1.5,
              dy: 20,
              width: 60,
              height: 40,
            },
          ],
        ]),
      ]),
    );
    const resizing = harness.commitElementBoundsById(
      boundsIntents,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    );
    const request = await acknowledge(2, FIELDS);
    await expect(resizing).resolves.toBe(true);
    expect(request.ops).toHaveLength(4);
    expect(members(harness.captureEditorDocument())).toEqual(
      originals.map((position) => ({
        ...position,
        dx: position.dx * 1.5,
        width: 60,
        height: 40,
      })),
    );
    expect(harness.captureEditorDocument().layerGroups).toEqual(
      before.layerGroups,
    );
  });
});
