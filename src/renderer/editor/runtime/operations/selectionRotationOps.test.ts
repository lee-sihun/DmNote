import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalEditorDocumentV1,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorField,
} from '@src/types/editor';
import type { PreviewDomain } from '@src/types/preview';
import type { SelectionRotationTarget } from '@utils/element/selectionRotation';
import {
  makeCanonicalSpritePosition,
  makeSpritePose,
} from '@utils/sprite/spriteFixtures';
import { createDefaultKeyPosition } from '../../model/keys';

const transport = vi.hoisted(() => {
  let resolveCommit!: (value: EditorCommitResult) => void;
  let rejectCommit!: (error: unknown) => void;
  let listener: ((event: EditorCommittedV1) => void) | null = null;
  return {
    get: vi.fn(),
    commit: vi.fn(
      (_request: EditorCommitRequest) =>
        new Promise<EditorCommitResult>((resolve, reject) => {
          resolveCommit = resolve;
          rejectCommit = reject;
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
    resolve: (value: EditorCommitResult) => resolveCommit(value),
    reject: (error: unknown) => rejectCommit(error),
    emit: (event: EditorCommittedV1) => listener?.(event),
    subscribe: vi.fn(async () => 1),
    publish: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
});

vi.mock('@api/modules/editor/editorApi', () => ({ editorApi: transport }));
vi.mock('@api/modules/editor/previewApi', () => ({ previewApi: transport }));

const MODE = '4key';
const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
] as const;
const OTHER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TYPES = ['key', 'stat', 'graph', 'knob', 'sprite'] as const;
const TARGETS: SelectionRotationTarget[] = TYPES.map((type, index) => ({
  type,
  id: IDS[index],
}));
const FIELD_BY_TYPE = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
  sprite: 'spritePositions',
} as const;
const FIELDS: EditorField[] = Object.values(FIELD_BY_TYPE);
const DOMAIN_BY_TYPE: Record<(typeof TYPES)[number], PreviewDomain> = {
  key: 'keyPosition',
  stat: 'statPosition',
  graph: 'graphPosition',
  knob: 'knobPosition',
  sprite: 'spritePosition',
};

const makeDocument = (): CanonicalEditorDocumentV1 => {
  const positions = [45, -30, 180, -180].map((rotation, index) => ({
    ...createDefaultKeyPosition(index * 100, 20),
    id: IDS[index],
    width: 40,
    height: 20,
    rotation,
    groupId: 'rotation-group',
  }));
  return {
    schemaVersion: 1,
    keys: { [MODE]: ['A', 'Z'], '7key': [] },
    keyPositions: {
      [MODE]: [
        positions[0],
        { ...createDefaultKeyPosition(900, 200), id: OTHER_ID },
      ],
      '7key': [],
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
    spritePositions: {
      [MODE]: [
        makeCanonicalSpritePosition({
          id: IDS[4],
          dx: 440,
          dy: 40,
          width: 60,
          height: 80,
          rotation: 30,
          groupId: 'rotation-group',
          pivot: { x: 0.25, y: 0.75 },
          idleTransform: { x: 5, y: -3, rotation: -20, scale: 1.2 },
          poses: [
            makeSpritePose({
              poseId: '11111111-1111-4111-8111-111111111111',
              triggers: [IDS[0]],
              pivot: { x: 1, y: 0 },
              transform: { x: 10, y: 4, rotation: 20, scale: 0.8 },
            }),
          ],
        }),
      ],
    },
    layerGroups: { [MODE]: [{ id: 'rotation-group', name: '혼합 그룹' }] },
  };
};

const loadHarness = async () => {
  const [state, gesture, preview, rotation, geometry, queue, keys] =
    await Promise.all([
      import('../coordinator/editorStateCoordinator'),
      import('../gesture/editGestureController'),
      import('../gesture/previewOverlay'),
      import('./selectionRotationOps'),
      import('@utils/element/selectionRotation'),
      import('../lifecycle/editorCompatibilityQueue'),
      import('@stores/data/useKeyStore'),
    ]);
  return {
    ...state,
    ...gesture,
    ...preview,
    ...rotation,
    ...geometry,
    ...queue,
    ...keys,
  };
};
type Harness = Awaited<ReturnType<typeof loadHarness>>;
let harness: Harness;

describe('선택 공통 회전 런타임', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    window.__dmn_window_type = 'main';
    transport.get.mockResolvedValue({ revision: 0, document: makeDocument() });
    harness = await loadHarness();
    harness.useKeyStore.setState({ selectedKeyType: MODE });
    await harness.editorCoordinator.start();
  });

  afterEach(() => {
    harness.editGestureController.cancel();
    harness.editorCoordinator.stop();
    harness.previewOverlay.clearAll();
    vi.restoreAllMocks();
    delete window.__dmn_window_type;
  });

  const snapshot = () =>
    harness.createSelectionRotationSnapshot(
      harness.captureEditorDocument(),
      TARGETS,
      MODE,
    )!;

  const requestAt = async (count: number) => {
    await vi.waitFor(() =>
      expect(transport.commit).toHaveBeenCalledTimes(count),
    );
    return transport.commit.mock.calls[count - 1][0];
  };

  const acknowledge = async (revision: number) => {
    transport.resolve({ revision, changedFields: FIELDS });
    await vi.waitFor(() =>
      expect(harness.editorCoordinator.getState()).toMatchObject({
        revision,
        phase: 'idle',
      }),
    );
  };

  const emitExternal = async (
    document: CanonicalEditorDocumentV1,
    changedFields: EditorField[],
  ) => {
    const revision = (harness.editorCoordinator.getState().revision ?? 0) + 1;
    const patch: EditorCommittedV1['patch'] = { schemaVersion: 1 };
    for (const field of changedFields) {
      Object.assign(patch, { [field]: document[field] });
    }
    transport.emit({
      schemaVersion: 1,
      revision,
      mutationId: crypto.randomUUID(),
      origin: 'plugin',
      changedFields,
      patch,
    });
    await vi.waitFor(() =>
      expect(harness.editorCoordinator.getState().revision).toBe(revision),
    );
  };

  const holdQueue = async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = harness.enqueueEditorCompatibilityOperation(() => gate);
    await Promise.resolve();
    return { release, pending };
  };

  it('5종의 상대 각도·크기를 보존한 프리뷰를 같은 gesture의 changes 한 건으로 저장한다', async () => {
    const initial = structuredClone(harness.captureEditorDocument());
    const start = snapshot();
    expect(harness.previewSelectionRotation(start, 30)).toBe(true);
    const gestureId = harness.editGestureController.activeGestureId()!;
    expect(harness.previewSelectionRotation(start, 90)).toBe(true);
    expect(harness.editGestureController.activeGestureId()).toBe(gestureId);
    expect(harness.captureEditorDocument()).toEqual(initial);

    const updates = harness.rotateSelection(start, 90)!;
    for (const { type, id, patch } of updates) {
      const field = FIELD_BY_TYPE[type];
      const record = initial[field] as Record<string, Array<{ id: string }>>;
      const preview = harness.composePreviewPositions(
        DOMAIN_BY_TYPE[type],
        record,
      );
      expect(preview[MODE].find((entry) => entry.id === id)).toMatchObject(
        patch,
      );
    }

    const pending = harness.commitSelectionRotation(start, 90, { gestureId });
    harness.editGestureController.settleCommit(pending);
    const request = await requestAt(1);
    expect(request.ops).toBeUndefined();
    expect(request.gestureId).toBe(gestureId);
    expect(Object.keys(request.changes!)).toEqual(
      expect.arrayContaining(['schemaVersion', ...FIELDS]),
    );
    expect(request.changes!.layerGroups).toBeUndefined();
    await acknowledge(1);
    await expect(pending).resolves.toBe(true);

    const saved = harness.captureEditorDocument();
    expect([
      saved.keyPositions[MODE][0].rotation,
      saved.statPositions[MODE][0].rotation,
      saved.graphPositions[MODE][0].rotation,
      saved.knobPositions[MODE][0].rotation,
    ]).toEqual([135, 60, -90, -90]);
    for (const { type, id, patch } of updates) {
      const before = initial[FIELD_BY_TYPE[type]][MODE].find(
        (entry) => entry.id === id,
      )!;
      expect(
        saved[FIELD_BY_TYPE[type]][MODE].find((entry) => entry.id === id),
      ).toEqual({ ...before, ...patch });
    }
    expect(saved.keyPositions[MODE][1]).toEqual(initial.keyPositions[MODE][1]);
    expect(saved.layerGroups).toEqual(initial.layerGroups);
    expect(saved.spritePositions[MODE][0].rotation).toBe(120);
    expect(saved.spritePositions[MODE][0].idleTransform).toEqual(
      initial.spritePositions[MODE][0].idleTransform,
    );
    expect(saved.spritePositions[MODE][0].poses).toEqual(
      initial.spritePositions[MODE][0].poses,
    );
    const after = snapshot();
    start.corners.forEach((point, index) => {
      expect(after.corners[index].x).toBeCloseTo(
        start.center.x - (point.y - start.center.y),
        8,
      );
      expect(after.corners[index].y).toBeCloseTo(
        start.center.y + (point.x - start.center.x),
        8,
      );
    });
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    expect(transport.commit).toHaveBeenCalledOnce();
  });

  it.each([Number.NaN, Infinity, -Infinity])(
    '유효하지 않은 각도 %s는 프리뷰와 저장을 시작하지 않는다',
    async (delta) => {
      const initial = structuredClone(harness.captureEditorDocument());
      const start = snapshot();
      expect(harness.previewSelectionRotation(start, delta)).toBe(false);
      await expect(harness.commitSelectionRotation(start, delta)).resolves.toBe(
        false,
      );
      expect(harness.captureEditorDocument()).toEqual(initial);
      expect(harness.editGestureController.activeGestureId()).toBeNull();
      expect(transport.commit).not.toHaveBeenCalled();
    },
  );

  it('프리뷰를 시작 각도로 되돌리면 모든 종류의 원래 기하를 다시 표시한다', () => {
    const initial = structuredClone(harness.captureEditorDocument());
    const start = snapshot();
    expect(harness.previewSelectionRotation(start, 90)).toBe(true);
    expect(harness.previewSelectionRotation(start, 0)).toBe(true);

    for (const type of TYPES) {
      const record = initial[FIELD_BY_TYPE[type]] as Record<
        string,
        Array<{ id: string }>
      >;
      expect(
        harness.composePreviewPositions(DOMAIN_BY_TYPE[type], record),
      ).toEqual(record);
    }
    expect(harness.captureEditorDocument()).toEqual(initial);
    expect(transport.commit).not.toHaveBeenCalled();
  });

  it('키 200개의 서로 다른 회전 위치를 한 번의 store 갱신과 프리뷰 알림으로 표시한다', async () => {
    const changed = structuredClone(harness.captureEditorDocument());
    changed.keys[MODE] = Array.from({ length: 200 }, () => 'A');
    changed.keyPositions[MODE] = Array.from({ length: 200 }, (_, index) => ({
      ...createDefaultKeyPosition(
        (index % 20) * 60,
        Math.floor(index / 20) * 40,
      ),
      id: crypto.randomUUID(),
      width: 40,
      height: 20,
    }));
    changed.statPositions[MODE] = [];
    changed.graphPositions[MODE] = [];
    changed.knobPositions[MODE] = [];
    changed.spritePositions[MODE] = [];
    await emitExternal(changed, ['keys', ...FIELDS]);
    const targets = changed.keyPositions[MODE].map(({ id }) => ({
      type: 'key' as const,
      id,
    }));
    const start = harness.createSelectionRotationSnapshot(
      changed,
      targets,
      MODE,
    )!;
    const overlayChanged = vi.fn();
    const renderedChanged = vi.fn();
    const unsubscribeOverlay = harness.subscribePreviewOverlay(overlayChanged);
    const unsubscribeStore = harness.useKeyStore.subscribe(
      (current, previous) => {
        if (current.positions !== previous.positions) renderedChanged();
      },
    );
    try {
      expect(harness.previewSelectionRotation(start, 90)).toBe(true);
      expect(overlayChanged).toHaveBeenCalledOnce();
      expect(renderedChanged).toHaveBeenCalledOnce();
      expect(harness.captureEditorDocument()).toEqual(changed);
      expect(harness.useKeyStore.getState().positions[MODE]).toHaveLength(200);
      expect(
        harness.useKeyStore
          .getState()
          .positions[MODE].every(({ rotation }) => rotation === 90),
      ).toBe(true);
    } finally {
      unsubscribeOverlay();
      unsubscribeStore();
    }
  });

  it('대상 하나만 회전 후 좌표 한계를 넘더라도 전체 선택의 프리뷰·저장을 함께 거절한다', async () => {
    const changed = structuredClone(harness.captureEditorDocument());
    changed.keyPositions[MODE][0].dx = 32_700;
    changed.keyPositions[MODE][0].dy = 32_700;
    await emitExternal(changed, ['keyPositions']);
    const start = snapshot();

    expect(harness.previewSelectionRotation(start, 45)).toBe(false);
    await expect(harness.commitSelectionRotation(start, 45)).resolves.toBe(
      false,
    );

    expect(harness.captureEditorDocument()).toEqual(changed);
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    expect(transport.commit).not.toHaveBeenCalled();
  });

  it('base 회전이 ±180° 경계를 지나도 자세의 전환 각도차와 offset을 그대로 저장한다', async () => {
    const changed = structuredClone(harness.captureEditorDocument());
    const sprite = changed.spritePositions[MODE][0];
    sprite.rotation = 170;
    sprite.idleTransform = { x: 2000, y: 2000, rotation: 170, scale: 1.2 };
    sprite.poses[0].transform.rotation = -170;
    await emitExternal(changed, ['spritePositions']);
    const start = snapshot();
    expect(harness.previewSelectionRotation(start, 20)).toBe(true);
    const pending = harness.commitSelectionRotation(start, 20, {
      gestureId: harness.editGestureController.activeGestureId()!,
    });
    harness.editGestureController.settleCommit(pending);
    const request = await requestAt(1);
    expect(request.changes!.spritePositions![MODE][0]).toMatchObject({
      rotation: -170,
      idleTransform: sprite.idleTransform,
      poses: sprite.poses,
    });
    await acknowledge(2);
    await expect(pending).resolves.toBe(true);

    const saved = harness.captureEditorDocument().spritePositions[MODE][0];
    expect(saved.rotation).toBe(-170);
    expect(saved.idleTransform).toEqual(sprite.idleTransform);
    expect(saved.poses).toEqual(sprite.poses);
    expect(
      saved.poses[0].transform.rotation - saved.idleTransform.rotation,
    ).toBe(-340);
  });

  it('반복 회전에서도 다시 계산한 AABB 대신 선택틀이 정한 공통 중심을 유지한다', async () => {
    const center = { x: 100, y: 75 };
    for (const [index, expected] of [
      { dx: 125, dy: -15, rotation: 135 },
      { dx: 160, dy: 110, rotation: -135 },
    ].entries()) {
      const canonical = snapshot();
      expect(canonical.center).not.toEqual(center);
      const start = { ...canonical, center };
      expect(harness.previewSelectionRotation(start, 90)).toBe(true);
      expect(
        harness.composePreviewPositions(
          'keyPosition',
          harness.captureEditorDocument().keyPositions,
        )[MODE][0],
      ).toMatchObject(expected);

      const pending = harness.commitSelectionRotation(start, 90, {
        gestureId: harness.editGestureController.activeGestureId()!,
      });
      harness.editGestureController.settleCommit(pending);
      await requestAt(index + 1);
      await acknowledge(index + 1);
      await expect(pending).resolves.toBe(true);
      expect(
        harness.captureEditorDocument().keyPositions[MODE][0],
      ).toMatchObject(expected);
    }
  });

  it.each([
    'missingOne',
    'missingAll',
    'otherMode',
    'geometryChanged',
    'positionChanged',
    'rotationChanged',
  ] as const)(
    '%s이면 전체 선택을 중단하고 남은 대상만 회전하지 않는다',
    async (reason) => {
      const start = snapshot();
      const changed = structuredClone(harness.captureEditorDocument());
      switch (reason) {
        case 'missingOne':
          changed.statPositions[MODE] = [];
          break;
        case 'missingAll':
          changed.keys[MODE] = ['Z'];
          changed.keyPositions[MODE] = [changed.keyPositions[MODE][1]];
          changed.statPositions[MODE] = [];
          changed.graphPositions[MODE] = [];
          changed.knobPositions[MODE] = [];
          changed.spritePositions[MODE] = [];
          break;
        case 'otherMode':
          changed.graphPositions['7key'] = changed.graphPositions[MODE];
          delete changed.graphPositions['7key'][0].groupId;
          changed.graphPositions[MODE] = [];
          break;
        case 'geometryChanged':
          changed.spritePositions[MODE][0].poses[0].transform.rotation += 0.01;
          break;
        case 'positionChanged':
          changed.keyPositions[MODE][0].dx += 0.01;
          break;
        case 'rotationChanged':
          changed.graphPositions[MODE][0].rotation -= 0.01;
          break;
      }
      await emitExternal(changed, ['keys', ...FIELDS]);

      expect(harness.previewSelectionRotation(start, 45)).toBe(false);
      await expect(harness.commitSelectionRotation(start, 45)).resolves.toBe(
        false,
      );
      expect(harness.captureEditorDocument()).toEqual(changed);
      expect(harness.editGestureController.activeGestureId()).toBeNull();
      expect(transport.commit).not.toHaveBeenCalled();
    },
  );

  it('직렬 큐에서 최신 스타일·자세 트리거를 보존하고 제출 후 탭 이동도 다른 탭을 건드리지 않는다', async () => {
    const start = snapshot();
    const initial = structuredClone(harness.captureEditorDocument());
    const queue = await holdQueue();
    const pending = harness.commitSelectionRotation(start, 90, {
      gestureId: 'selection-rotation-queued',
    });
    expect(harness.captureEditorDocument()).toEqual(initial);
    expect(transport.commit).not.toHaveBeenCalled();

    const styled = structuredClone(initial);
    styled.keyPositions[MODE][0].fontSize = 28;
    styled.keyPositions[MODE][1].noteWidth = 777;
    styled.knobPositions[MODE][0].sensitivity = 7;
    styled.spritePositions[MODE][0].transitionMs = 125;
    styled.spritePositions[MODE][0].poses[0].triggers = [OTHER_ID];
    await emitExternal(styled, [
      'keyPositions',
      'knobPositions',
      'spritePositions',
    ]);
    harness.useKeyStore.setState({ selectedKeyType: '7key' });
    queue.release();
    await queue.pending;

    const request = await requestAt(1);
    expect(request.baseRevision).toBe(1);
    expect(request.gestureId).toBe('selection-rotation-queued');
    expect(
      request.changes!.spritePositions![MODE][0].poses[0].triggers,
    ).toEqual([OTHER_ID]);
    await acknowledge(2);
    await expect(pending).resolves.toBe(true);
    const saved = harness.captureEditorDocument();
    expect(saved.keyPositions[MODE][0].fontSize).toBe(28);
    expect(saved.keyPositions[MODE][1].noteWidth).toBe(777);
    expect(saved.knobPositions[MODE][0].sensitivity).toBe(7);
    expect(saved.spritePositions[MODE][0].transitionMs).toBe(125);
    expect(saved.spritePositions[MODE][0].poses[0].triggers).toEqual([
      OTHER_ID,
    ]);
    expect(saved.keyPositions['7key']).toEqual(styled.keyPositions['7key']);
  });

  it.each(['missingOne', 'geometryChanged'] as const)(
    '제출 뒤 큐 대기 중 %s도 wire 생성 전에 전체 중단한다',
    async (reason) => {
      const start = snapshot();
      const initial = structuredClone(harness.captureEditorDocument());
      const queue = await holdQueue();
      const pending = harness.commitSelectionRotation(start, 90);
      const changed = structuredClone(initial);
      if (reason === 'missingOne') changed.knobPositions[MODE] = [];
      else changed.knobPositions[MODE][0].dx += 0.01;
      await emitExternal(changed, ['knobPositions']);
      queue.release();
      await queue.pending;

      await expect(pending).resolves.toBe(false);
      expect(harness.captureEditorDocument()).toEqual(changed);
      expect(transport.commit).not.toHaveBeenCalled();
    },
  );

  it('백엔드 거절 시 실제 coordinator가 5종 모두를 마지막 저장값으로 복원한다', async () => {
    const initial = structuredClone(harness.captureEditorDocument());
    const start = snapshot();
    const error = {
      errorCode: 'VALIDATION_FAILED',
      message: 'rotation rejected',
      details: { validationCode: 'COORDINATE_OUT_OF_RANGE' },
      retryable: false,
    };
    expect(harness.previewSelectionRotation(start, 45)).toBe(true);
    const pending = harness.commitSelectionRotation(start, 45, {
      gestureId: harness.editGestureController.activeGestureId()!,
    });
    harness.editGestureController.settleCommit(pending);
    const rejected = expect(pending).rejects.toEqual(error);
    await requestAt(1);
    expect(harness.captureEditorDocument()).not.toEqual(initial);
    transport.reject(error);
    await rejected;

    expect(harness.captureEditorDocument()).toEqual(initial);
    for (const type of TYPES) {
      const record = initial[FIELD_BY_TYPE[type]] as Record<
        string,
        Array<{ id: string }>
      >;
      expect(
        harness.composePreviewPositions(DOMAIN_BY_TYPE[type], record),
      ).toEqual(record);
    }
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    expect(harness.editorCoordinator.getState()).toMatchObject({
      dirty: false,
      pendingLocal: null,
      failureKind: 'permanent',
    });
  });

  it('큐 편입 전 실패는 canonical에 회전 잔여물을 남기지 않는다', async () => {
    const initial = structuredClone(harness.captureEditorDocument());
    const start = snapshot();
    const error = new Error('editor initialization failed');
    vi.spyOn(harness.editorCoordinator, 'start').mockRejectedValueOnce(error);

    await expect(harness.commitSelectionRotation(start, 45)).rejects.toBe(
      error,
    );

    expect(harness.captureEditorDocument()).toEqual(initial);
    expect(transport.commit).not.toHaveBeenCalled();
  });
});
