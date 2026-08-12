import { describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import {
  EditorProtocolError,
  assertEditorGetResult,
  assertSafeEditorRevision,
  isEditorCommitError,
} from '@src/types/editor';

import {
  EditorReadOnlyError,
  applyEditorPatch,
  createEditorCoordinator,
  createEditorPatch,
  getChangedEditorFields,
} from './editorCoordinator';
import {
  enqueueEditorCompatibilityOperation,
  enqueueEditorCompatibilityWrite,
} from './editorCompatibilityQueue';

import type {
  EditorCommitError,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorDocumentV1,
  EditorGetResult,
  EditorOpResultV1,
  EditorOpV1,
} from '@src/types/editor';
import type { KeySlot } from '@src/types/key/keys';
import type {
  EditorApplyReason,
  EditorCoordinatorOptions,
  EditorCoordinatorTransport,
  EditorReadyUnsubscribe,
} from './editorCoordinator';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const makeDocument = (key = 'A'): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { '4key': [key] },
  keyPositions: { '4key': [createDefaultKeyPosition()] },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  layerGroups: {},
});

const withGroups = (
  document: EditorDocumentV1,
  id: string,
): EditorDocumentV1 => ({
  ...structuredClone(document),
  layerGroups: { '4key': [{ id, name: id }] },
});

const revisionConflict = (): EditorCommitError => ({
  errorCode: 'REVISION_CONFLICT',
  message: 'revision conflict',
  details: { currentRevision: 1 },
  retryable: true,
});

const ioError = (): EditorCommitError => ({
  errorCode: 'IO_ERROR',
  message: 'disk unavailable',
  retryable: true,
});

const validationError = (): EditorCommitError => ({
  errorCode: 'VALIDATION_FAILED',
  message: 'invalid editor document',
  details: { validationCode: 'INVALID_STAT_TYPE' },
  retryable: false,
});

class FakeTransport implements EditorCoordinatorTransport {
  canonical: EditorGetResult;
  readonly getMock = vi.fn<() => Promise<EditorGetResult>>();
  readonly commitMock =
    vi.fn<(request: EditorCommitRequest) => Promise<EditorCommitResult>>();
  private listener: ((event: EditorCommittedV1) => void) | null = null;

  constructor(document: EditorDocumentV1, revision = 0) {
    this.canonical = { revision, document: structuredClone(document) };
    this.getMock.mockImplementation(async () =>
      structuredClone(this.canonical),
    );
    this.commitMock.mockImplementation(async (request) => {
      const before = this.canonical.document;
      const next = request.changes
        ? applyEditorPatch(before, request.changes)
        : applyOpsForTest(before, request.ops);
      const changedFields = getChangedEditorFields(before, next);
      if (changedFields.length > 0) this.canonical.revision += 1;
      this.canonical.document = next;
      return {
        revision: this.canonical.revision,
        changedFields,
        ...(request.ops
          ? {
              opResults: request.ops.map(
                (op): EditorOpResultV1 => ({
                  status: changedFields.length > 0 ? 'applied' : 'noChange',
                  bounds: op.bounds,
                }),
              ),
            }
          : {}),
      };
    });
  }

  get(): Promise<EditorGetResult> {
    return this.getMock();
  }

  commit(request: EditorCommitRequest): Promise<EditorCommitResult> {
    return this.commitMock(request);
  }

  onCommitted(
    listener: (event: EditorCommittedV1) => void,
  ): EditorReadyUnsubscribe {
    this.listener = listener;
    return Object.assign(
      () => {
        this.listener = null;
      },
      { ready: Promise.resolve() },
    );
  }

  emit(event: EditorCommittedV1): void {
    this.listener?.(structuredClone(event));
  }
}

const eventFor = (
  revision: number,
  mutationId: string,
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorCommittedV1 => ({
  schemaVersion: 1,
  revision,
  mutationId,
  origin: 'legacy:test',
  changedFields: getChangedEditorFields(base, next),
  patch: createEditorPatch(base, next),
});

const createHarness = (
  initial: EditorDocumentV1,
  options: Partial<
    Pick<
      EditorCoordinatorOptions,
      | 'focusTarget'
      | 'visibilityTarget'
      | 'readOnly'
      | 'onCommittedApplied'
      | 'onGestureIdsDiscarded'
      | 'onStartSucceeded'
    >
  > = {},
) => {
  const transport = new FakeTransport(initial);
  let local = structuredClone(initial);
  const applications: Array<{
    document: EditorDocumentV1;
    reason: EditorApplyReason;
  }> = [];
  let mutationSequence = 0;
  const coordinator = createEditorCoordinator({
    transport,
    readDocument: () => structuredClone(local),
    applyDocument: (document, reason) => {
      local = structuredClone(document);
      applications.push({ document: structuredClone(document), reason });
    },
    createMutationId: () =>
      `00000000-0000-4000-8000-${String(++mutationSequence).padStart(12, '0')}`,
    focusTarget: options.focusTarget ?? null,
    visibilityTarget: options.visibilityTarget ?? null,
    readOnly: options.readOnly,
    onCommittedApplied: options.onCommittedApplied,
    onGestureIdsDiscarded: options.onGestureIdsDiscarded,
    onStartSucceeded: options.onStartSucceeded,
  });

  return {
    coordinator,
    transport,
    applications,
    getLocal: () => structuredClone(local),
    setLocal: (document: EditorDocumentV1) => {
      local = structuredClone(document);
    },
  };
};

const applyOpsForTest = (
  document: EditorDocumentV1,
  ops: readonly EditorOpV1[],
): EditorDocumentV1 => {
  const next = structuredClone(document);
  const fields = {
    key: 'keyPositions',
    stat: 'statPositions',
    graph: 'graphPositions',
    knob: 'knobPositions',
  } as const;
  ops.forEach((op) => {
    const record = next[fields[op.elementType]] as Record<
      string,
      Array<Record<string, unknown>>
    >;
    Object.entries(record).some(([mode, positions]) => {
      const index = positions.findIndex((position) => position.id === op.id);
      if (index < 0) return false;
      record[mode] = positions.map((position, positionIndex) =>
        positionIndex === index ? { ...position, ...op.bounds } : position,
      );
      return true;
    });
  });
  return next;
};

describe('editor document helpers', () => {
  it('creates and applies a top-level collection patch', () => {
    const base = makeDocument();
    const next = withGroups({ ...base, keys: { '4key': ['B'] } }, 'group-1');

    const patch = createEditorPatch(base, next);

    expect(patch).toEqual({
      schemaVersion: 1,
      keys: { '4key': ['B'] },
      layerGroups: { '4key': [{ id: 'group-1', name: 'group-1' }] },
    });
    expect(applyEditorPatch(base, patch)).toEqual(next);
  });

  it('rejects revisions that cannot be represented safely in JavaScript', () => {
    expect(() => assertSafeEditorRevision(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      EditorProtocolError,
    );
    expect(() => assertSafeEditorRevision(-1)).toThrow(EditorProtocolError);
    expect(() => assertSafeEditorRevision(1.5)).toThrow(EditorProtocolError);
  });

  it('accepts null serialized by Rust for optional position fields', () => {
    const rustWirePosition = {
      ...createDefaultKeyPosition(),
      activeImage: null,
      inactiveImage: null,
      soundEnabled: null,
      soundPath: null,
      soundVolume: null,
      noteOpacityTop: null,
      noteOpacityBottom: null,
      noteBorderRadius: null,
      noteWidth: null,
      noteGlowOpacityTop: null,
      noteGlowOpacityBottom: null,
      noteGlowColor: null,
      noteOffsetX: null,
      noteOffsetY: null,
      noteBorderWidth: null,
      noteBorderColor: null,
      noteBorderSide: null,
      className: null,
      zIndex: null,
      backgroundColor: null,
      activeBackgroundColor: null,
      borderColor: null,
      activeBorderColor: null,
      borderWidth: null,
      borderRadius: null,
      fontSize: null,
      fontColor: null,
      activeFontColor: null,
      graphAnimationEnabled: null,
      fontFamily: null,
      imageFit: null,
      idleImageFit: null,
      activeImageFit: null,
      useInlineStyles: null,
      displayText: null,
      fontWeight: null,
      fontItalic: null,
      fontUnderline: null,
      fontStrikethrough: null,
      layerName: null,
      groupId: null,
    };
    const result = {
      revision: 0,
      document: {
        ...makeDocument(),
        keyPositions: { '4key': [rustWirePosition] },
      },
    } as unknown as EditorGetResult;

    expect(() => assertEditorGetResult(result)).not.toThrow();
  });

  it.each(['TOO_MANY_GESTURE_IDS', 'INVALID_GESTURE_ID'] as const)(
    'recognizes %s as a non-retryable editor commit error',
    (errorCode) => {
      expect(
        isEditorCommitError({
          errorCode,
          message: errorCode,
          retryable: false,
        }),
      ).toBe(true);
    },
  );

  it('still rejects null for required position fields', () => {
    const result = {
      revision: 0,
      document: {
        ...makeDocument(),
        keyPositions: {
          '4key': [{ ...createDefaultKeyPosition(), width: null }],
        },
      },
    } as unknown as EditorGetResult;

    expect(() => assertEditorGetResult(result)).toThrow(EditorProtocolError);
  });

  it.each([
    ['null collection', { schemaVersion: 1, keys: null }],
    ['unknown field', { schemaVersion: 1, unknown: {} }],
    [
      'mismatched paired length',
      { schemaVersion: 1, keys: { '4key': ['A', 'B'] } },
    ],
    [
      'invalid geometry',
      {
        schemaVersion: 1,
        keyPositions: {
          '4key': [{ ...createDefaultKeyPosition(), width: -1 }],
        },
      },
    ],
  ])('rejects malformed %s before applying it', (_label, malformed) => {
    expect(() =>
      applyEditorPatch(
        makeDocument(),
        malformed as unknown as import('@src/types/editor').EditorPatchV1,
      ),
    ).toThrow(EditorProtocolError);
  });

  it('does not optimistically apply or transport a malformed patch', async () => {
    const harness = createHarness(makeDocument());
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: null,
      } as unknown as import('@src/types/editor').EditorPatchV1),
    ).rejects.toThrow(EditorProtocolError);

    expect(harness.transport.commitMock).not.toHaveBeenCalled();
    expect(
      harness.applications.filter(({ reason }) => reason === 'localPatch'),
    ).toHaveLength(0);
    harness.coordinator.stop();
  });
});

describe('EditorSaveCoordinator', () => {
  it('settles same-tick gesture and isolated plugin commits without deadlock', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    // 같은 tick에 gesture 커밋 직후 플러그인 격리 커밋 - 상호 대기 교착 회귀 방지
    const gesture = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': ['B'] } },
      'gesture-a',
      async (context) =>
        harness.transport.commit({
          baseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          changes: context.editorChanges!,
        }),
    );
    const isolated = harness.coordinator.commitIsolatedPluginPatch(
      {
        schemaVersion: 1,
        keys: { '4key': [{ keys: ['C', 'D'], match: 'any' }] },
      },
      { multiKey: true },
    );

    await expect(gesture).resolves.toBeTruthy();
    const isolatedDocument = await isolated;
    expect(isolatedDocument.keys['4key']).toEqual([
      { keys: ['C', 'D'], match: 'any' },
    ]);

    // 실행 창 로컬 문서도 canonical로 갱신됨 (이후 flush의 되돌림 방지)
    expect(harness.getLocal().keys['4key']).toEqual([
      { keys: ['C', 'D'], match: 'any' },
    ]);

    // 성공 후 코디네이터 상태 완전 정리 (inFlight 잔존 시 가짜 충돌 유발)
    const stateAfterIsolated = harness.coordinator.getState();
    expect(stateAfterIsolated.phase).toBe('idle');
    expect(stateAfterIsolated.dirty).toBe(false);
    expect(stateAfterIsolated.inFlightMutationId).toBeNull();

    const callsAfterIsolated = harness.transport.commitMock.mock.calls.length;
    await harness.coordinator.commitEditorState();
    expect(harness.transport.commitMock.mock.calls.length).toBe(
      callsAfterIsolated,
    );

    // 격리 커밋 envelope는 플러그인이 선언한 multiKey 값을 그대로 전달
    const isolatedRequest = harness.transport.commitMock.mock.calls.at(-1)?.[0];
    expect(isolatedRequest?.multiKey).toBe(true);

    // 이후 자사 커밋도 정상 진행 (큐 고착 없음)
    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: { '4key': ['E'] },
      }),
    ).resolves.toBeTruthy();
    harness.coordinator.stop();
  });

  // 백엔드 v1 adapter 흉내 (계약 §3 충실 재현): 무ID 요소는 같은 자리의
  // 값 일치만 ID를 승계하고, 값이 수정된 요소는 새 ID를 발급한다. stale
  // baseRevision은 실백엔드처럼 REVISION_CONFLICT로 거절한다. 결과
  // envelope에는 adapted 값이 없으므로 coordinator는 get으로만 알 수 있다
  const emulateV1AdapterCommit = (
    harness: ReturnType<typeof createHarness>,
  ) => {
    let issued = 0;
    const valueWithoutId = (position: Record<string, unknown>) => {
      const { id: _id, ...rest } = position;
      return JSON.stringify(rest);
    };
    harness.transport.commitMock.mockImplementation(async (request) => {
      if (request.baseRevision !== harness.transport.canonical.revision) {
        throw revisionConflict();
      }
      if (!request.changes) {
        throw new Error('expected an isolated patch');
      }
      const before = harness.transport.canonical.document;
      const next = applyEditorPatch(before, request.changes);
      for (const [mode, positions] of Object.entries(next.keyPositions)) {
        positions.forEach((position, index) => {
          if (position.id) return;
          const current = before.keyPositions[mode]?.[index];
          position.id =
            current?.id && valueWithoutId(current) === valueWithoutId(position)
              ? current.id
              : `fresh-${(issued += 1)}`;
        });
      }
      const changedFields = getChangedEditorFields(before, next);
      if (changedFields.length > 0) harness.transport.canonical.revision += 1;
      harness.transport.canonical.document = next;
      return {
        revision: harness.transport.canonical.revision,
        changedFields,
      };
    });
  };

  const strippedIdPositions = (document: EditorDocumentV1) => {
    const positions = structuredClone(document.keyPositions);
    Object.values(positions).forEach((list) =>
      list.forEach((position) => {
        delete position.id;
      }),
    );
    return positions;
  };

  it('keeps canonical element ids after a no-op idless plugin commit', async () => {
    const base = makeDocument('A');
    const idBefore = base.keyPositions['4key'][0].id;
    expect(idBefore).toBeTruthy();
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();

    const result = await harness.coordinator.commitIsolatedPluginPatch(
      {
        schemaVersion: 1,
        keys: base.keys,
        keyPositions: strippedIdPositions(base),
      },
      { multiKey: false },
    );

    // 백엔드는 ID를 보존했다 - lastAck가 무ID 요청값으로 덮이면 안 된다
    expect(result.keyPositions['4key'][0].id).toBe(idBefore);
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);
  });

  it('mirrors adapter-issued ids after a changing idless plugin commit', async () => {
    const base = makeDocument('A');
    const idBefore = base.keyPositions['4key'][0].id;
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();

    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    const result = await harness.coordinator.commitIsolatedPluginPatch(
      { schemaVersion: 1, keys: base.keys, keyPositions: moved },
      { multiKey: false },
    );

    // 값이 수정된 무ID 요소는 계약(§3)상 새 ID를 받는다. own committed
    // 이벤트는 revision 선점으로 패치가 무시되므로 커밋 경로 자체가
    // 백엔드가 발급한 canonical ID를 되찾아 비춰야 한다
    const adaptedId =
      harness.transport.canonical.document.keyPositions['4key'][0].id;
    expect(adaptedId).toBeTruthy();
    expect(adaptedId).not.toBe(idBefore);
    expect(result.keyPositions['4key'][0].dx).toBe(moved['4key'][0].dx);
    expect(result.keyPositions['4key'][0].id).toBe(adaptedId);
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(adaptedId);
  });

  it('삭제 후 stale 재제출로 재발급된 요소에 옛 ID 완료가 닿지 않는다', async () => {
    // 계약 신뢰 경계 필수 테스트: retired-ID 집합 없이도 이 체인이 안전해야 한다
    const base = makeDocument('A');
    const retiredId = base.keyPositions['4key'][0].id;
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();

    // 1) 비동기 완료가 retiredId를 캡처해 둔 상태에서 요소 삭제
    await harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: { '4key': [] },
      keyPositions: { '4key': [] },
    });
    expect(harness.transport.canonical.document.keyPositions['4key']).toEqual(
      [],
    );

    // 2) 삭제 전 스냅샷을 든 stale v1 클라이언트가 무ID로 재제출 -
    //    계약(§3)상 삭제된 ID를 승계하지 못하고 새 ID를 발급받는다
    await harness.coordinator.commitIsolatedPluginPatch(
      {
        schemaVersion: 1,
        keys: base.keys,
        keyPositions: strippedIdPositions(base),
      },
      { multiKey: false },
    );
    const reissued =
      harness.transport.canonical.document.keyPositions['4key'][0];
    expect(reissued.id).toBeTruthy();
    expect(reissued.id).not.toBe(retiredId);

    // 3) 옛 ID에 묶인 완료가 실행돼도 재발급 요소를 건드리지 않는다
    const commitsBefore = harness.transport.commitMock.mock.calls.length;
    const result = await harness.coordinator.commitGeneratedPatch((latest) => {
      const record = structuredClone(latest.keyPositions);
      let touched = false;
      for (const list of Object.values(record)) {
        list.forEach((position, index) => {
          if (position.id !== retiredId) return;
          list[index] = { ...position, inactiveImage: 'stale.png' };
          touched = true;
        });
      }
      return touched ? { schemaVersion: 1, keyPositions: record } : null;
    });

    expect(harness.transport.commitMock.mock.calls.length).toBe(commitsBefore);
    const finalPosition =
      harness.transport.canonical.document.keyPositions['4key'][0];
    expect(finalPosition.id).toBe(reissued.id);
    expect(finalPosition.inactiveImage ?? '').toBe('');
    expect(result.keyPositions['4key'][0].inactiveImage ?? '').toBe('');
    expect(harness.getLocal().keyPositions['4key'][0].inactiveImage ?? '').toBe(
      '',
    );
    harness.coordinator.stop();
  });

  it('resyncs on retry conflict so plugin retries recover without ui sync', async () => {
    const base = makeDocument('A');
    const idBefore = base.keyPositions['4key'][0].id;
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();
    harness.transport.getMock.mockRejectedValueOnce(
      new Error('ipc unavailable'),
    );

    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    const patch = {
      schemaVersion: 1 as const,
      keys: base.keys,
      keyPositions: moved,
    };
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(patch, {
        multiKey: false,
      }),
    ).rejects.toThrow('ipc unavailable');

    // 무ID target이 lastAck·스토어를 오염시키지 않는다 (이전 canonical 유지)
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);
    expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
      base.keyPositions['4key'][0].dx,
    );

    // revision이 뒤처진 재시도는 실백엔드 계약대로 충돌하되, 격리 경로가
    // conflict에서 canonical을 재동기화해 둔다 (플러그인은 sync 접근 불가)
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(patch, {
        multiKey: false,
      }),
    ).rejects.toMatchObject({ errorCode: 'REVISION_CONFLICT' });

    // 별도 ui sync 없이도 conflict 반환 시점에 이미 복구돼 있다
    const adaptedId =
      harness.transport.canonical.document.keyPositions['4key'][0].id;
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(adaptedId);
    expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
      moved['4key'][0].dx,
    );

    // 다음 재시도는 정상 완료된다 (값 일치라 승계, no-op)
    const retried = await harness.coordinator.commitIsolatedPluginPatch(patch, {
      multiKey: false,
    });
    expect(retried.keyPositions['4key'][0].id).toBe(adaptedId);
    harness.coordinator.stop();
  });

  it('recovers the local store from the own event after a failed post-commit read', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();
    harness.transport.getMock.mockRejectedValueOnce(
      new Error('ipc unavailable'),
    );

    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(
        { schemaVersion: 1, keys: base.keys, keyPositions: moved },
        { multiKey: false },
      ),
    ).rejects.toThrow('ipc unavailable');

    // own committed 이벤트가 lastAck뿐 아니라 store까지 복구한다
    const request = harness.transport.commitMock.mock.calls[0][0];
    harness.transport.emit(
      eventFor(
        harness.transport.canonical.revision,
        request.mutationId,
        base,
        harness.transport.canonical.document,
      ),
    );
    await vi.waitFor(() =>
      expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
        moved['4key'][0].dx,
      ),
    );
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(
      harness.transport.canonical.document.keyPositions['4key'][0].id,
    );
    expect(harness.getLocal().keyPositions['4key'][0].id).toBeTruthy();

    // 후속 flush가 성공한 플러그인 변경을 낡은 로컬로 되돌리지 않는다
    const commitsBefore = harness.transport.commitMock.mock.calls.length;
    await harness.coordinator.commitEditorState();
    expect(harness.transport.commitMock.mock.calls.length).toBe(commitsBefore);
    harness.coordinator.stop();
  });

  it('recovers the local store when the own event lands before the failed read', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();
    harness.transport.getMock.mockImplementationOnce(async () => {
      const request = harness.transport.commitMock.mock.calls[0][0];
      harness.transport.emit(
        eventFor(
          harness.transport.canonical.revision,
          request.mutationId,
          base,
          harness.transport.canonical.document,
        ),
      );
      throw new Error('ipc unavailable');
    });

    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(
        { schemaVersion: 1, keys: base.keys, keyPositions: moved },
        { multiKey: false },
      ),
    ).rejects.toThrow('ipc unavailable');

    await vi.waitFor(() =>
      expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
        moved['4key'][0].dx,
      ),
    );
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(
      harness.transport.canonical.document.keyPositions['4key'][0].id,
    );
    expect(harness.getLocal().keyPositions['4key'][0].id).toBeTruthy();

    const commitsBefore = harness.transport.commitMock.mock.calls.length;
    await harness.coordinator.commitEditorState();
    expect(harness.transport.commitMock.mock.calls.length).toBe(commitsBefore);
    harness.coordinator.stop();
  });

  it('does not mistake an isolated in-flight target for pending when an external event lands first', async () => {
    const base = makeDocument('A');
    const idBefore = base.keyPositions['4key'][0].id;
    const harness = createHarness(base);
    await harness.coordinator.start();

    // 다른 창의 커밋이 먼저 반영됨 - 이벤트가 격리 커밋 in-flight 중 도착하고
    // 격리 커밋은 실백엔드처럼 stale base로 거절된다
    const external = structuredClone(base);
    external.keys['4key'] = ['B'];
    harness.transport.commitMock.mockImplementationOnce(async () => {
      harness.transport.canonical = {
        revision: 1,
        document: structuredClone(external),
      };
      harness.transport.emit(eventFor(1, 'external-1', base, external));
      await new Promise((resolve) => setTimeout(resolve, 0));
      throw revisionConflict();
    });

    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(
        { schemaVersion: 1, keys: base.keys, keyPositions: moved },
        { multiKey: false },
      ),
    ).rejects.toMatchObject({ errorCode: 'REVISION_CONFLICT' });

    // 화면은 거절된 플러그인 값이 아니라 외부 canonical이어야 한다
    await vi.waitFor(() =>
      expect(harness.getLocal().keys['4key']).toEqual(['B']),
    );
    expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
      base.keyPositions['4key'][0].dx,
    );
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);
    harness.coordinator.stop();
  });

  it('keeps canonical ids when a late own event overlaps a retrying isolated commit', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    emulateV1AdapterCommit(harness);
    await harness.coordinator.start();
    harness.transport.getMock.mockRejectedValueOnce(
      new Error('ipc unavailable'),
    );

    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    const patch = {
      schemaVersion: 1 as const,
      keys: base.keys,
      keyPositions: moved,
    };
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(patch, {
        multiKey: false,
      }),
    ).rejects.toThrow('ipc unavailable');
    const request = harness.transport.commitMock.mock.calls[0][0];
    const adapted = structuredClone(harness.transport.canonical.document);

    // 재시도가 전송 대기 중일 때 늦은 own 이벤트가 도착한다
    const gate = deferred<EditorCommitResult>();
    harness.transport.commitMock.mockImplementationOnce(() => gate.promise);
    const retry = harness.coordinator.commitIsolatedPluginPatch(patch, {
      multiKey: false,
    });
    await vi.waitFor(() =>
      expect(harness.transport.commitMock.mock.calls.length).toBe(2),
    );
    harness.transport.emit(eventFor(1, request.mutationId, base, adapted));
    await vi.waitFor(() =>
      expect(harness.getLocal().keyPositions['4key'][0].id).toBe(
        adapted.keyPositions['4key'][0].id,
      ),
    );

    // 재시도는 실백엔드처럼 stale base로 거절되고, canonical UUID는 유지된다
    gate.reject(revisionConflict());
    await expect(retry).rejects.toMatchObject({
      errorCode: 'REVISION_CONFLICT',
    });
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(
      adapted.keyPositions['4key'][0].id,
    );
    expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
      moved['4key'][0].dx,
    );
    harness.coordinator.stop();
  });

  it('keeps first-party commit bases off the isolated in-flight target', async () => {
    const base = makeDocument('A');
    const idBefore = base.keyPositions['4key'][0].id;
    // start()는 호출마다 이 훅을 기다린다. 자사 호출만 여기서 정지시켜
    // "빈 tail 통과 -> start 대기 중 격리 커밋이 in-flight" TOCTOU 순서를
    // 결정적으로 만든다
    const startGates: Array<Deferred<void>> = [];
    const harness = createHarness(base, {
      onStartSucceeded: () => {
        const gate = deferred<void>();
        startGates.push(gate);
        return gate.promise;
      },
    });
    const starting = harness.coordinator.start();
    await vi.waitFor(() => expect(startGates.length).toBe(1));
    startGates[0].resolve(undefined);
    await starting;

    // 자사 커밋이 먼저 진입해 start 훅에서 대기한다
    const firstParty = harness.coordinator.commitPatch({
      schemaVersion: 1,
      layerGroups: { '4key': [{ id: 'group-1', name: 'group-1' }] },
    });
    await vi.waitFor(() => expect(startGates.length).toBe(2));

    // 그 사이 격리 커밋이 in-flight가 된다
    const commitGate = deferred<EditorCommitResult>();
    harness.transport.commitMock.mockImplementationOnce(
      () => commitGate.promise,
    );
    const moved = strippedIdPositions(base);
    moved['4key'][0].dx += 10;
    const isolated = harness.coordinator.commitIsolatedPluginPatch(
      { schemaVersion: 1, keys: base.keys, keyPositions: moved },
      { multiKey: false },
    );
    await vi.waitFor(() => expect(startGates.length).toBe(3));
    startGates[2].resolve(undefined);
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );

    // 자사 호출이 재개되어 base를 계산한다 - 미승인 격리 target이 base면
    // 오염은 wire가 아니라 lastAck 승인으로 귀결된다 (아래 단언)
    startGates[1].resolve(undefined);
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledTimes(2),
    );
    const firstPartyRequest = harness.transport.commitMock.mock.calls[1][0];
    expect(firstPartyRequest.changes.layerGroups).toBeDefined();
    expect(firstPartyRequest.changes.keyPositions).toBeUndefined();

    // 오염은 wire가 아니라 lastAck로 귀결된다 - base가 격리 target이면
    // 자사 커밋 성공 시 applyCommitResult가 무ID keyPositions를 lastAck로
    // 승인하고, 다음 flush가 이를 근거로 플러그인 변경을 되돌린다
    await firstParty;
    const acknowledged = harness.coordinator.getState().lastAck!;
    expect(acknowledged.keyPositions['4key'][0].id).toBe(idBefore);
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);

    // 정리: 격리 커밋을 adapted canonical로 완료시킨다
    const adapted = structuredClone(
      harness.transport.canonical.document,
    ) as EditorDocumentV1;
    adapted.keyPositions['4key'][0].dx = moved['4key'][0].dx;
    harness.transport.canonical = {
      revision: harness.transport.canonical.revision + 1,
      document: structuredClone(adapted),
    };
    commitGate.resolve({
      revision: harness.transport.canonical.revision,
      changedFields: ['keyPositions'],
    });
    await isolated;
    await firstParty;
    harness.coordinator.stop();
  });

  it('stamps the wire schema version by transport path', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    // 자사 일반 커밋 wire는 v2 - 호출부 패치 버전과 무관하게 경로가 결정
    await harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: { '4key': ['B'] },
    });
    expect(
      harness.transport.commitMock.mock.calls.at(-1)?.[0].changes.schemaVersion,
    ).toBe(2);

    // 게스처 커밋 wire도 v2
    let gestureWireVersion: number | undefined;
    await harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': ['C'] } },
      'gesture-wire',
      async (context) => {
        gestureWireVersion = context.editorChanges?.schemaVersion;
        return harness.transport.commit({
          baseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          changes: context.editorChanges!,
        });
      },
    );
    expect(gestureWireVersion).toBe(2);

    // 플러그인 격리 커밋 wire는 v1 유지 (레거시 패치 수용 경계)
    await harness.coordinator.commitIsolatedPluginPatch(
      { schemaVersion: 1, keys: { '4key': ['D'] } },
      { multiKey: false },
    );
    expect(
      harness.transport.commitMock.mock.calls.at(-1)?.[0].changes.schemaVersion,
    ).toBe(1);
    harness.coordinator.stop();
  });

  it('keeps queued mixed gestures as separate ordered transactions', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();
    const firstResponse = deferred<EditorCommitResult>();
    const contexts: Array<{
      gestureId: string;
      editorBaseRevision: number;
      mutationId: string;
      keys: KeySlot[] | undefined;
    }> = [];

    const first = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': ['B'] } },
      'gesture-a',
      async (context) => {
        contexts.push({
          gestureId: 'gesture-a',
          editorBaseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          keys: context.editorChanges?.keys?.['4key'],
        });
        return firstResponse.promise;
      },
    );
    const second = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': ['C'] } },
      'gesture-b',
      async (context) => {
        contexts.push({
          gestureId: 'gesture-b',
          editorBaseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          keys: context.editorChanges?.keys?.['4key'],
        });
        return { revision: 2, changedFields: ['keys'] };
      },
    );

    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0]).toMatchObject({
      gestureId: 'gesture-a',
      editorBaseRevision: 0,
      keys: ['B'],
    });
    firstResponse.resolve({ revision: 1, changedFields: ['keys'] });
    await expect(first).resolves.toMatchObject({ keys: { '4key': ['B'] } });
    await expect(second).resolves.toMatchObject({ keys: { '4key': ['C'] } });

    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toMatchObject({
      gestureId: 'gesture-b',
      editorBaseRevision: 1,
      keys: ['C'],
    });
    expect(contexts[0].mutationId).not.toBe(contexts[1].mutationId);
    expect(harness.coordinator.getState().lastAck).toMatchObject({
      keys: { '4key': ['C'] },
    });
    harness.coordinator.stop();
  });

  it('resyncs canonical state when a gesture result is outcome-unknown', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    // 키만 다른 문서다. positions id까지 갈리면 resync 판정과 무관한 차이가 섞인다
    target.keyPositions = structuredClone(base.keyPositions);
    const harness = createHarness(base);
    await harness.coordinator.start();

    const committing = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: target.keys },
      'gesture-a',
      async () => {
        harness.transport.canonical = { revision: 1, document: target };
        throw ioError();
      },
    );

    await expect(committing).rejects.toEqual(ioError());
    expect(harness.coordinator.getState().revision).toBe(1);
    expect(harness.coordinator.getState().lastAck).toEqual(target);
    expect(harness.getLocal()).toEqual(target);
    harness.coordinator.stop();
  });

  it('editor 전용 gesture의 IO 실패는 최신 문서에서 자동 재시도한다', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    target.keyPositions = structuredClone(base.keyPositions);
    const harness = createHarness(base);
    const transientError = ioError();
    harness.transport.commitMock
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ revision: 1, changedFields: ['keys'] });
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: target.keys },
        'gesture-native-only',
        (context) =>
          harness.transport.commit({
            baseRevision: context.editorBaseRevision,
            mutationId: context.mutationId,
            changes: context.editorChanges!,
          }),
        { reconcileRetryableEditorIntent: () => true },
      ),
    ).resolves.toEqual(target);

    expect(harness.getLocal()).toEqual(target);
    expect(harness.coordinator.getState()).toMatchObject({
      dirty: false,
      failureKind: null,
    });
    expect(harness.transport.commitMock).toHaveBeenCalledTimes(2);
    harness.coordinator.stop();
  });

  it('혼합 gesture의 재시도 가능 실패는 editor만 따로 재시도하지 않는다', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    target.keyPositions = structuredClone(base.keyPositions);
    const harness = createHarness(base);
    const transientError = ioError();
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: target.keys },
        'gesture-mixed',
        () => Promise.reject(transientError),
        { reconcileRetryableEditorIntent: () => false },
      ),
    ).rejects.toBe(transientError);

    expect(harness.getLocal()).toEqual(base);
    expect(harness.coordinator.getState()).toMatchObject({
      dirty: false,
      pendingLocal: null,
      failureKind: 'transient',
    });
    await expect(harness.coordinator.retryPending()).resolves.toEqual(base);
    harness.coordinator.stop();
  });

  it('editor 전용 gesture가 다른 필드의 외부 변경과 안전하게 합쳐진다', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    target.keyPositions = structuredClone(base.keyPositions);
    const remote = withGroups(base, 'remote');
    const expected = withGroups(target, 'remote');
    const harness = createHarness(base);
    harness.transport.commitMock.mockResolvedValueOnce({
      revision: 2,
      changedFields: ['keys'],
    });
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: target.keys },
        'gesture-unrelated-rebase',
        () => Promise.reject(revisionConflict()),
        { reconcileRetryableEditorIntent: () => true },
      ),
    ).resolves.toEqual(expected);

    expect(harness.getLocal()).toEqual(expected);
    expect(harness.transport.commitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 1,
        gestureId: 'gesture-unrelated-rebase',
        gestureIds: ['gesture-unrelated-rebase'],
      }),
    );
    harness.coordinator.stop();
  });

  it('editor 전용 gesture와 같은 필드의 외부 변경은 충돌로 전환한다', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    target.keyPositions = structuredClone(base.keyPositions);
    const remote = makeDocument('C');
    remote.keyPositions = structuredClone(base.keyPositions);
    const harness = createHarness(base);
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: target.keys },
        'gesture-overlap',
        () => Promise.reject(revisionConflict()),
        { reconcileRetryableEditorIntent: () => true },
      ),
    ).rejects.toMatchObject({ errorCode: 'REVISION_CONFLICT' });

    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'conflict',
      failureKind: null,
      conflict: {
        pendingLocal: target,
        canonical: remote,
        localFields: ['keys'],
        overlappingFields: ['keys'],
      },
    });
    expect(harness.transport.commitMock).not.toHaveBeenCalled();
    harness.coordinator.stop();
  });

  it('editor 전용 gesture 충돌에서 내 편집을 유지하면 같은 gesture ID로 저장한다', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    target.keyPositions = structuredClone(base.keyPositions);
    const remote = makeDocument('C');
    remote.keyPositions = structuredClone(base.keyPositions);
    const harness = createHarness(base);
    harness.transport.commitMock.mockResolvedValueOnce({
      revision: 2,
      changedFields: ['keys'],
    });
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: target.keys },
        'gesture-keep-local',
        () => Promise.reject(revisionConflict()),
        { reconcileRetryableEditorIntent: () => true },
      ),
    ).rejects.toMatchObject({ errorCode: 'REVISION_CONFLICT' });

    await harness.coordinator.resolveConflict('keepLocal');
    expect(harness.transport.commitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 1,
        gestureId: 'gesture-keep-local',
        gestureIds: ['gesture-keep-local'],
      }),
    );
    harness.coordinator.stop();
  });

  it('IO 응답 유실 뒤 같은 필드가 더 바뀌면 옛 목표로 덮지 않는다', async () => {
    const base = makeDocument('A');
    const target = makeDocument('B');
    target.keyPositions = structuredClone(base.keyPositions);
    const remote = makeDocument('C');
    remote.keyPositions = structuredClone(base.keyPositions);
    const harness = createHarness(base);
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 2, document: remote };

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: target.keys },
        'gesture-io-overlap',
        () => Promise.reject(ioError()),
        { reconcileRetryableEditorIntent: () => true },
      ),
    ).rejects.toBeDefined();

    expect(harness.transport.commitMock).not.toHaveBeenCalled();
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'conflict',
      failureKind: null,
    });
    expect(harness.coordinator.getState().conflict?.canonical).toEqual(remote);
    harness.coordinator.stop();
  });

  it('gesture 실패가 이후 진행 중인 낙관 편집을 되돌리지 않는다', async () => {
    const base = makeDocument('A');
    const gestureTarget = makeDocument('B');
    const laterOptimistic = makeDocument('C');
    const harness = createHarness(base);
    await harness.coordinator.start();
    const response = deferred<EditorCommitResult>();

    const committing = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: gestureTarget.keys },
      'gesture-a',
      () => response.promise,
    );
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().phase).toBe('saving'),
    );
    harness.setLocal(laterOptimistic);
    response.reject(validationError());

    await expect(committing).rejects.toEqual(validationError());
    expect(harness.coordinator.getState().lastAck).toEqual(base);
    expect(harness.getLocal()).toEqual(laterOptimistic);
    harness.coordinator.stop();
  });

  it('runs the start success hook after initialization recovers lazily', async () => {
    const initializationError = new Error('initial get failed');
    const onStartSucceeded = vi.fn(async () => {});
    const harness = createHarness(makeDocument(), { onStartSucceeded });
    harness.transport.getMock.mockRejectedValueOnce(initializationError);

    await expect(harness.coordinator.start()).rejects.toBe(initializationError);
    expect(onStartSucceeded).not.toHaveBeenCalled();

    await expect(harness.coordinator.start()).resolves.toMatchObject({
      revision: 0,
    });
    expect(onStartSucceeded).toHaveBeenCalledOnce();

    await harness.coordinator.start();
    expect(onStartSucceeded).toHaveBeenCalledTimes(2);
    harness.coordinator.stop();
  });

  it('buffers events until the initial snapshot closes the subscription race', async () => {
    const base = makeDocument();
    const next = { ...base, keys: { '4key': ['B'] } };
    const harness = createHarness(base);
    const initialGet = deferred<EditorGetResult>();
    harness.transport.getMock.mockReturnValueOnce(initialGet.promise);

    const starting = harness.coordinator.start();
    await vi.waitFor(() =>
      expect(harness.transport.getMock).toHaveBeenCalledOnce(),
    );
    harness.transport.emit(eventFor(1, 'external-1', base, next));
    initialGet.resolve({ revision: 0, document: base });
    await starting;

    expect(harness.coordinator.getState().revision).toBe(1);
    expect(harness.getLocal()).toEqual(next);
    expect(harness.applications.map(({ reason }) => reason)).toEqual([
      'initial',
      'event',
    ]);
    harness.coordinator.stop();
  });

  it('keeps one request in flight and saves only the latest dirty snapshot next', async () => {
    const base = makeDocument();
    const firstTarget = { ...base, keys: { '4key': ['B'] } };
    const latestTarget = { ...base, keys: { '4key': ['C'] } };
    const harness = createHarness(base);
    const firstResult = deferred<EditorCommitResult>();
    const secondResult = deferred<EditorCommitResult>();
    harness.transport.commitMock
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);
    await harness.coordinator.start();

    harness.setLocal(firstTarget);
    const firstCommit = harness.coordinator.commitEditorState();
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledTimes(1),
    );

    harness.setLocal(latestTarget);
    const secondCommit = harness.coordinator.commitEditorState();
    expect(harness.transport.commitMock).toHaveBeenCalledTimes(1);

    firstResult.resolve({ revision: 1, changedFields: ['keys'] });
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledTimes(2),
    );
    secondResult.resolve({ revision: 2, changedFields: ['keys'] });
    await Promise.all([firstCommit, secondCommit]);

    const requests = harness.transport.commitMock.mock.calls.map(
      ([request]) => request,
    );
    expect(requests[0].baseRevision).toBe(0);
    expect(requests[0].changes.keys).toEqual({ '4key': ['B'] });
    expect(requests[1].baseRevision).toBe(1);
    expect(requests[1].changes.keys).toEqual({ '4key': ['C'] });
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'idle',
      revision: 2,
      dirty: false,
    });
    harness.coordinator.stop();
  });

  it('persists a quick revert that happens while the first value is in flight', async () => {
    const base = makeDocument();
    const firstTarget = { ...base, keys: { '4key': ['B'] } };
    const harness = createHarness(base);
    const firstResult = deferred<EditorCommitResult>();
    const revertResult = deferred<EditorCommitResult>();
    harness.transport.commitMock
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(revertResult.promise);
    await harness.coordinator.start();

    const firstCommit = harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: firstTarget.keys,
    });
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );

    const revertCommit = harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: base.keys,
    });
    firstResult.resolve({ revision: 1, changedFields: ['keys'] });
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledTimes(2),
    );

    expect(harness.transport.commitMock.mock.calls[1][0].changes.keys).toEqual(
      base.keys,
    );
    revertResult.resolve({ revision: 2, changedFields: ['keys'] });
    await Promise.all([firstCommit, revertCommit]);

    expect(harness.getLocal()).toEqual(base);
    expect(harness.coordinator.getState()).toMatchObject({
      revision: 2,
      lastAck: base,
      dirty: false,
    });
    harness.coordinator.stop();
  });

  it('merges same-tick patches with every gesture ID', async () => {
    const base = makeDocument();
    const keyPositions = structuredClone(base.keyPositions);
    keyPositions['4key'][0].dx = 10;
    const statPositions = { '4key': [] };
    const graphPositions = { '4key': [] };
    const knobPositions = { '4key': [] };
    const expected = {
      ...base,
      keyPositions,
      statPositions,
      graphPositions,
      knobPositions,
    };
    const harness = createHarness(base);
    const firstResult = deferred<EditorCommitResult>();
    const mergedResult = deferred<EditorCommitResult>();
    harness.transport.commitMock
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(mergedResult.promise);
    await harness.coordinator.start();

    const commits = [
      harness.coordinator.commitPatch(
        { schemaVersion: 1, keyPositions },
        { gestureId: 'gesture-key' },
      ),
      harness.coordinator.commitPatch(
        { schemaVersion: 1, statPositions },
        { gestureId: 'gesture-stat' },
      ),
      harness.coordinator.commitPatch(
        { schemaVersion: 1, graphPositions },
        { gestureId: 'gesture-graph' },
      ),
      harness.coordinator.commitPatch(
        { schemaVersion: 1, knobPositions },
        { gestureId: 'gesture-knob' },
      ),
    ];
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );

    firstResult.resolve({ revision: 1, changedFields: ['keyPositions'] });
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledTimes(2),
    );
    expect(harness.transport.commitMock.mock.calls[1][0].changes).toEqual({
      schemaVersion: 2,
      statPositions,
      graphPositions,
      knobPositions,
    });
    expect(harness.transport.commitMock.mock.calls[0][0]).toMatchObject({
      gestureId: 'gesture-key',
      gestureIds: ['gesture-key'],
    });
    expect(harness.transport.commitMock.mock.calls[1][0]).toMatchObject({
      gestureId: 'gesture-knob',
      gestureIds: ['gesture-stat', 'gesture-graph', 'gesture-knob'],
    });

    mergedResult.resolve({
      revision: 2,
      changedFields: ['statPositions', 'graphPositions', 'knobPositions'],
    });
    await Promise.all(commits);

    expect(harness.getLocal()).toEqual(expected);
    expect(harness.coordinator.getState()).toMatchObject({
      revision: 2,
      lastAck: expected,
      dirty: false,
    });
    harness.coordinator.stop();
  });

  it('keeps the newest 32 gesture IDs across an IO failure and retry', async () => {
    const base = makeDocument();
    const onGestureIdsDiscarded =
      vi.fn<(gestureIds: readonly string[]) => void>();
    const harness = createHarness(base, { onGestureIdsDiscarded });
    const firstResult = deferred<EditorCommitResult>();
    harness.transport.commitMock.mockReturnValueOnce(firstResult.promise);
    const gestureIds = Array.from(
      { length: 34 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    await harness.coordinator.start();

    const commits = [
      harness.coordinator.commitPatch(
        { schemaVersion: 1, keys: { '4key': ['value-0'] } },
        { gestureId: gestureIds[0] },
      ),
    ];
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );

    for (let index = 1; index < gestureIds.length; index += 1) {
      commits.push(
        harness.coordinator.commitPatch(
          { schemaVersion: 1, keys: { '4key': [`value-${index}`] } },
          { gestureId: gestureIds[index] },
        ),
      );
    }
    await vi.waitFor(() =>
      expect(onGestureIdsDiscarded).toHaveBeenCalledOnce(),
    );

    const transientError = ioError();
    firstResult.reject(transientError);
    const results = await Promise.allSettled(commits);
    expect(results.every(({ status }) => status === 'rejected')).toBe(true);
    expect(harness.coordinator.getState()).toMatchObject({
      dirty: true,
      failureKind: 'transient',
    });

    await expect(harness.coordinator.retryPending()).resolves.toMatchObject({
      keys: { '4key': ['value-33'] },
    });
    expect(harness.transport.commitMock).toHaveBeenCalledTimes(2);
    const retryRequest = harness.transport.commitMock.mock.calls[1][0];
    expect(retryRequest.gestureIds).toEqual(gestureIds.slice(-32));
    expect(retryRequest.gestureIds).toHaveLength(32);
    expect(retryRequest.gestureId).toBe(gestureIds.at(-1));
    expect(retryRequest.gestureIds).toContain(retryRequest.gestureId);
    expect(onGestureIdsDiscarded.mock.calls.flatMap(([ids]) => ids)).toEqual([
      gestureIds[1],
      gestureIds[0],
    ]);
    harness.coordinator.stop();
  });

  it('does not apply its own event twice when it arrives before the response', async () => {
    const base = makeDocument();
    const target = { ...base, keys: { '4key': ['B'] } };
    const harness = createHarness(base);
    const response = deferred<EditorCommitResult>();
    harness.transport.commitMock.mockReturnValueOnce(response.promise);
    await harness.coordinator.start();
    harness.setLocal(target);

    const committing = harness.coordinator.commitEditorState();
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );
    const request = harness.transport.commitMock.mock.calls[0][0];
    harness.transport.emit(eventFor(1, request.mutationId, base, target));
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().revision).toBe(1),
    );

    expect(harness.applications.map(({ reason }) => reason)).toEqual([
      'initial',
    ]);
    response.resolve({ revision: 1, changedFields: ['keys'] });
    await committing;
    expect(harness.coordinator.getState().lastAck).toEqual(target);
    harness.coordinator.stop();
  });

  it('응답 뒤에 도착한 own event도 병합 gesture ID 정리를 전달', async () => {
    const base = makeDocument();
    const target = { ...base, keys: { '4key': ['B'] } };
    const onCommittedApplied = vi.fn();
    const harness = createHarness(base, { onCommittedApplied });
    await harness.coordinator.start();

    await harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: target.keys,
    });
    const request = harness.transport.commitMock.mock.calls[0][0];
    harness.transport.emit({
      ...eventFor(1, request.mutationId, base, target),
      gestureIds: ['main-session', 'panel-session'],
    });

    await vi.waitFor(() => expect(onCommittedApplied).toHaveBeenCalledOnce());
    expect(onCommittedApplied.mock.calls[0][0].gestureIds).toEqual([
      'main-session',
      'panel-session',
    ]);
    harness.coordinator.stop();
  });

  it('resynchronizes a revision gap and ignores an older event', async () => {
    const base = makeDocument();
    const remote = withGroups({ ...base, keys: { '4key': ['C'] } }, 'remote');
    const harness = createHarness(base);
    harness.transport.canonical = { revision: 1, document: base };
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 3, document: remote };

    harness.transport.emit(eventFor(3, 'external-3', base, remote));
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().revision).toBe(3),
    );
    expect(harness.getLocal()).toEqual(remote);
    expect(harness.transport.getMock).toHaveBeenCalledTimes(2);

    harness.transport.emit(eventFor(2, 'external-2', base, remote));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.transport.getMock).toHaveBeenCalledTimes(2);
    harness.coordinator.stop();
  });

  it('revision gap 재동기화 실패에도 committed 프리뷰 정리를 전달', async () => {
    const base = makeDocument();
    const remote = withGroups({ ...base, keys: { '4key': ['C'] } }, 'remote');
    const onCommittedApplied = vi.fn();
    const harness = createHarness(base, { onCommittedApplied });
    await harness.coordinator.start();
    const resyncError = new Error('resync unavailable');
    harness.transport.getMock.mockRejectedValueOnce(resyncError);

    harness.transport.emit({
      ...eventFor(2, 'external-gap', base, remote),
      gestureIds: ['00000000-0000-4000-8000-000000000001'],
    });

    await vi.waitFor(() => expect(onCommittedApplied).toHaveBeenCalledOnce());
    expect(onCommittedApplied.mock.calls[0][0].gestureIds).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ]);
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().error).toBe(resyncError),
    );
    expect(harness.coordinator.getState().revision).toBe(0);
    harness.coordinator.stop();
  });

  it('revalidates on focus and visible lifecycle transitions', async () => {
    class VisibilityTarget extends EventTarget {
      visibilityState = 'visible';
    }

    const base = makeDocument();
    const remote = withGroups(base, 'remote');
    const focusTarget = new EventTarget();
    const visibilityTarget = new VisibilityTarget();
    const harness = createHarness(base, { focusTarget, visibilityTarget });
    await harness.coordinator.start();

    harness.transport.canonical = { revision: 1, document: remote };
    focusTarget.dispatchEvent(new Event('focus'));
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().revision).toBe(1),
    );
    expect(harness.getLocal()).toEqual(remote);

    visibilityTarget.visibilityState = 'hidden';
    visibilityTarget.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.transport.getMock).toHaveBeenCalledTimes(2);

    visibilityTarget.visibilityState = 'visible';
    visibilityTarget.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() =>
      expect(harness.transport.getMock).toHaveBeenCalledTimes(3),
    );

    harness.coordinator.stop();
    focusTarget.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.transport.getMock).toHaveBeenCalledTimes(3);
  });

  it('can reapply the latest coordinator state after a stale bootstrap write', async () => {
    const staleBootstrap = makeDocument('A');
    const canonical = makeDocument('B');
    const harness = createHarness(staleBootstrap);
    harness.transport.canonical = { revision: 1, document: canonical };
    await harness.coordinator.start();
    expect(harness.getLocal()).toEqual(canonical);

    harness.setLocal(staleBootstrap);
    await harness.coordinator.sync({ reapply: true });

    expect(harness.coordinator.getState()).toMatchObject({
      revision: 1,
      lastAck: canonical,
      dirty: false,
    });
    expect(harness.getLocal()).toEqual(canonical);
    expect(harness.applications.at(-1)).toEqual({
      document: canonical,
      reason: 'resync',
    });
    harness.coordinator.stop();
  });

  it('rejects OBS writes before creating optimistic or dirty state', async () => {
    const canonical = makeDocument('A');
    const harness = createHarness(canonical, { readOnly: true });
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: { '4key': ['PLUGIN'] },
      }),
    ).rejects.toBeInstanceOf(EditorReadOnlyError);
    await harness.coordinator.sync({ reapply: true });

    expect(harness.transport.commitMock).not.toHaveBeenCalled();
    expect(harness.getLocal()).toEqual(canonical);
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'idle',
      lastAck: canonical,
      dirty: false,
      conflict: null,
    });
    harness.coordinator.stop();
  });

  it('evaluates read-only access when a write starts, not at module import time', async () => {
    const canonical = makeDocument('A');
    let readOnly = true;
    const harness = createHarness(canonical, { readOnly: () => readOnly });
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: { '4key': ['BLOCKED'] },
      }),
    ).rejects.toBeInstanceOf(EditorReadOnlyError);

    readOnly = false;
    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: { '4key': ['ALLOWED'] },
      }),
    ).resolves.toMatchObject({ keys: { '4key': ['ALLOWED'] } });
    expect(harness.transport.commitMock).toHaveBeenCalledOnce();
    harness.coordinator.stop();
  });

  it('automatically rebases disjoint fields and returns the final canonical document', async () => {
    const base = makeDocument();
    const local = { ...base, keys: { '4key': ['L'] } };
    const remote = withGroups(base, 'remote');
    const expected = withGroups(local, 'remote');
    const harness = createHarness(base);
    const conflict = revisionConflict();
    harness.transport.commitMock
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ revision: 2, changedFields: ['keys'] });
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };
    harness.setLocal(local);

    const result = await harness.coordinator.commitEditorState();

    expect(result).toEqual(expected);
    expect(harness.getLocal()).toEqual(expected);
    expect(harness.transport.commitMock).toHaveBeenCalledTimes(2);
    const retried = harness.transport.commitMock.mock.calls[1][0];
    expect(retried.baseRevision).toBe(1);
    expect(retried.changes).toEqual({
      schemaVersion: 2,
      keys: { '4key': ['L'] },
    });
    expect(harness.coordinator.getState().conflict).toBeNull();
    harness.coordinator.stop();
  });

  it('exposes all three documents without losing an overlapping local edit', async () => {
    const base = makeDocument();
    const local = { ...base, keys: { '4key': ['L'] } };
    const remote = { ...base, keys: { '4key': ['R'] } };
    const harness = createHarness(base);
    const conflictError = revisionConflict();
    harness.transport.commitMock.mockRejectedValueOnce(conflictError);
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };
    harness.setLocal(local);

    await expect(harness.coordinator.commitEditorState()).rejects.toEqual(
      conflictError,
    );
    expect(harness.coordinator.getState().conflict).toMatchObject({
      lastAck: base,
      pendingLocal: local,
      canonical: remote,
      canonicalRevision: 1,
      localFields: ['keys'],
      overlappingFields: ['keys'],
      reason: 'overlap',
    });
    expect(harness.getLocal()).toEqual(local);

    const accepted = await harness.coordinator.resolveConflict(
      'acceptCanonical',
    );
    expect(accepted).toEqual(remote);
    expect(harness.getLocal()).toEqual(remote);
    expect(harness.transport.commitMock).toHaveBeenCalledOnce();
    harness.coordinator.stop();
  });

  it('외부 변경 수용은 충돌한 gesture preview를 폐기한다', async () => {
    const base = makeDocument('A');
    const local = makeDocument('B');
    local.keyPositions = structuredClone(base.keyPositions);
    const remote = makeDocument('C');
    remote.keyPositions = structuredClone(base.keyPositions);
    const onGestureIdsDiscarded =
      vi.fn<(gestureIds: readonly string[]) => void>();
    const harness = createHarness(base, { onGestureIdsDiscarded });
    harness.transport.commitMock.mockRejectedValueOnce(revisionConflict());
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };

    await expect(
      harness.coordinator.commitPatch(
        { schemaVersion: 1, keys: local.keys },
        { gestureId: 'gesture-accept-external' },
      ),
    ).rejects.toMatchObject({ errorCode: 'REVISION_CONFLICT' });

    await harness.coordinator.resolveConflict('acceptCanonical');
    expect(harness.getLocal()).toEqual(remote);
    expect(onGestureIdsDiscarded).toHaveBeenCalledWith([
      'gesture-accept-external',
    ]);
    harness.coordinator.stop();
  });

  it('can keep the local side of an overlap and recommit it on the canonical revision', async () => {
    const base = makeDocument();
    const local = { ...base, keys: { '4key': ['L'] } };
    const remote = withGroups({ ...base, keys: { '4key': ['R'] } }, 'remote');
    const expected = withGroups(local, 'remote');
    const harness = createHarness(base);
    harness.transport.commitMock
      .mockRejectedValueOnce(revisionConflict())
      .mockResolvedValueOnce({ revision: 2, changedFields: ['keys'] });
    await harness.coordinator.start();
    harness.transport.canonical = { revision: 1, document: remote };
    harness.setLocal(local);

    await expect(harness.coordinator.commitEditorState()).rejects.toMatchObject(
      {
        errorCode: 'REVISION_CONFLICT',
      },
    );
    const result = await harness.coordinator.resolveConflict('keepLocal');

    expect(result).toEqual(expected);
    expect(harness.getLocal()).toEqual(expected);
    expect(harness.transport.commitMock.mock.calls[1][0]).toMatchObject({
      baseRevision: 1,
      changes: { schemaVersion: 2, keys: { '4key': ['L'] } },
    });
    harness.coordinator.stop();
  });

  it('turns an overlapping external event into a conflict while a save is dirty', async () => {
    const base = makeDocument();
    const local = { ...base, keys: { '4key': ['L'] } };
    const remote = { ...base, keys: { '4key': ['R'] } };
    const harness = createHarness(base);
    const response = deferred<EditorCommitResult>();
    const conflictError = revisionConflict();
    harness.transport.commitMock.mockReturnValueOnce(response.promise);
    await harness.coordinator.start();
    harness.setLocal(local);

    const committing = harness.coordinator.commitEditorState();
    const rejectedCommit = expect(committing).rejects.toEqual(conflictError);
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );
    harness.transport.emit(eventFor(1, 'external-1', base, remote));
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().phase).toBe('conflict'),
    );
    response.reject(conflictError);
    await rejectedCommit;

    expect(harness.coordinator.getState().conflict).toMatchObject({
      lastAck: base,
      pendingLocal: local,
      canonical: remote,
      overlappingFields: ['keys'],
    });
    expect(harness.getLocal()).toEqual(local);
    harness.coordinator.stop();
  });

  it('treats an external write of the same desired value as an acknowledgement', async () => {
    const base = makeDocument();
    const local = { ...base, keys: { '4key': ['L'] } };
    const harness = createHarness(base);
    const response = deferred<EditorCommitResult>();
    const conflictError = revisionConflict();
    harness.transport.commitMock.mockReturnValueOnce(response.promise);
    await harness.coordinator.start();
    harness.setLocal(local);

    const committing = harness.coordinator.commitEditorState();
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );
    harness.transport.canonical = { revision: 1, document: local };
    harness.transport.emit(eventFor(1, 'external-1', base, local));
    response.reject(conflictError);

    await expect(committing).resolves.toEqual(local);
    expect(harness.coordinator.getState()).toMatchObject({
      revision: 1,
      dirty: false,
      conflict: null,
    });
    harness.coordinator.stop();
  });

  it('keeps an IO-failed snapshot dirty and retries it explicitly', async () => {
    const base = makeDocument();
    const local = { ...base, keys: { '4key': ['L'] } };
    const harness = createHarness(base);
    const error = ioError();
    harness.transport.commitMock
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ revision: 1, changedFields: ['keys'] });
    await harness.coordinator.start();
    harness.setLocal(local);

    await expect(harness.coordinator.commitEditorState()).rejects.toEqual(
      error,
    );
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'error',
      dirty: true,
      pendingLocal: local,
      error,
      failureKind: 'transient',
    });

    const result = await harness.coordinator.retryPending();
    expect(result).toEqual(local);
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'idle',
      revision: 1,
      dirty: false,
    });
    harness.coordinator.stop();
  });

  it.each([
    ['a non-retryable backend rejection', validationError()],
    ['an unstructured transport rejection', new Error('invalid args')],
  ])(
    'drops %s, restores the last acknowledgement, and allows the next edit',
    async (_label, error) => {
      const base = makeDocument();
      const rejected = { ...base, keys: { '4key': ['REJECTED'] } };
      const next = { ...base, keys: { '4key': ['NEXT'] } };
      const harness = createHarness(base);
      harness.transport.commitMock
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ revision: 1, changedFields: ['keys'] });
      await harness.coordinator.start();
      harness.setLocal(rejected);

      await expect(harness.coordinator.commitEditorState()).rejects.toBe(error);

      expect(harness.getLocal()).toEqual(base);
      expect(harness.coordinator.getState()).toMatchObject({
        phase: 'error',
        dirty: false,
        pendingLocal: null,
        error,
        failureKind: 'permanent',
      });
      expect(harness.applications.at(-1)).toEqual({
        document: base,
        reason: 'rejected',
      });

      await expect(harness.coordinator.retryPending()).resolves.toEqual(base);
      expect(harness.transport.commitMock).toHaveBeenCalledOnce();

      harness.setLocal(next);
      await expect(harness.coordinator.commitEditorState()).resolves.toEqual(
        next,
      );
      expect(harness.transport.commitMock).toHaveBeenCalledTimes(2);
      expect(harness.coordinator.getState()).toMatchObject({
        phase: 'idle',
        dirty: false,
        failureKind: null,
      });
      harness.coordinator.stop();
    },
  );

  it('영구 거절은 in-flight gesture preview도 함께 폐기한다', async () => {
    const base = makeDocument();
    const target = { ...base, keys: { '4key': ['REJECTED'] } };
    const error = validationError();
    const onGestureIdsDiscarded =
      vi.fn<(gestureIds: readonly string[]) => void>();
    const harness = createHarness(base, { onGestureIdsDiscarded });
    harness.transport.commitMock.mockRejectedValueOnce(error);
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitPatch(
        { schemaVersion: 1, keys: target.keys },
        { gestureId: 'gesture-rejected-preview' },
      ),
    ).rejects.toBe(error);

    expect(harness.getLocal()).toEqual(base);
    expect(onGestureIdsDiscarded).toHaveBeenCalledOnce();
    expect(onGestureIdsDiscarded).toHaveBeenCalledWith([
      'gesture-rejected-preview',
    ]);
    harness.coordinator.stop();
  });

  it('혼합 gesture의 영구 거절도 editor preview를 폐기한다', async () => {
    const base = makeDocument();
    const error = validationError();
    const onGestureIdsDiscarded =
      vi.fn<(gestureIds: readonly string[]) => void>();
    const harness = createHarness(base, { onGestureIdsDiscarded });
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitGesture(
        { schemaVersion: 1, keys: { '4key': ['REJECTED'] } },
        'gesture-mixed-rejected',
        () => Promise.reject(error),
      ),
    ).rejects.toBe(error);

    expect(harness.getLocal()).toEqual(base);
    expect(onGestureIdsDiscarded).toHaveBeenCalledWith([
      'gesture-mixed-rejected',
    ]);
    harness.coordinator.stop();
  });

  it('uses commitPatch as an optimistic compatibility adapter and skips full-state no-ops', async () => {
    const base = makeDocument();
    const target = withGroups(base, 'group-1');
    const harness = createHarness(base);
    await harness.coordinator.start();

    const result = await harness.coordinator.commitPatch({
      schemaVersion: 1,
      layerGroups: target.layerGroups,
    });

    expect(result).toEqual(target);
    expect(harness.getLocal()).toEqual(target);
    expect(harness.applications.map(({ reason }) => reason)).toEqual([
      'initial',
      'localPatch',
    ]);
    expect(harness.transport.commitMock).toHaveBeenCalledOnce();

    await harness.coordinator.commitEditorState(target);
    expect(harness.transport.commitMock).toHaveBeenCalledOnce();
    harness.coordinator.stop();
  });

  it('forwards an explicit compatibility patch even when its value is unchanged', async () => {
    const base = makeDocument();
    const harness = createHarness(base);
    await harness.coordinator.start();

    const result = await harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: structuredClone(base.keys),
    });

    expect(result).toEqual(base);
    expect(harness.transport.commitMock).toHaveBeenCalledOnce();
    expect(harness.transport.commitMock.mock.calls[0][0].changes).toEqual({
      schemaVersion: 2,
      keys: base.keys,
    });
    expect(harness.transport.commitMock.mock.calls[0][0]).not.toHaveProperty(
      'ops',
    );
    expect(
      harness.transport.commitMock.mock.results[0].value,
    ).resolves.not.toHaveProperty('opResults');
    expect(harness.coordinator.getState()).toMatchObject({
      revision: 0,
      dirty: false,
      phase: 'idle',
    });
    harness.coordinator.stop();
  });

  it('does not pull an unrelated local preview into a compatibility patch', async () => {
    const base = makeDocument();
    const preview = {
      ...base,
      graphPositions: { '4key': [] },
    };
    const harness = createHarness(base);
    await harness.coordinator.start();
    harness.setLocal(preview);

    const result = await harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: { '4key': ['B'] },
    });

    expect(harness.transport.commitMock.mock.calls[0][0].changes).toEqual({
      schemaVersion: 2,
      keys: { '4key': ['B'] },
    });
    expect(result.graphPositions).toEqual(base.graphPositions);
    expect(harness.getLocal()).toMatchObject({
      keys: { '4key': ['B'] },
      graphPositions: preview.graphPositions,
    });
    harness.coordinator.stop();
  });
});
// 지연 생성 커밋: 호출 시점 캡처 patch가 대기 중 정산된 다른 커밋의 같은
// 컬렉션 값을 되돌리는 lost-update의 방어 경로
describe('commitGeneratedPatch', () => {
  const gatedDefaultCommit = (
    harness: ReturnType<typeof createHarness>,
    gate: Promise<void>,
  ) => {
    harness.transport.commitMock.mockImplementationOnce(async (request) => {
      await gate;
      const before = harness.transport.canonical.document;
      if (!request.changes) {
        throw new Error('expected a compatibility patch');
      }
      const next = applyEditorPatch(before, request.changes);
      const changedFields = getChangedEditorFields(before, next);
      if (changedFields.length > 0) harness.transport.canonical.revision += 1;
      harness.transport.canonical.document = next;
      return {
        revision: harness.transport.canonical.revision,
        changedFields,
      };
    });
  };

  const imageRecordFrom = (base: EditorDocumentV1) => {
    const record = structuredClone(base.keyPositions);
    record['4key'] = record['4key'].map((position, index) =>
      index === 0 ? { ...position, inactiveImage: 'generated.png' } : position,
    );
    return record;
  };

  it('게스처 in-flight 완료 후의 base에서 생성해 양쪽 값을 보존한다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    const gate = deferred<void>();
    gatedDefaultCommit(harness, gate.promise);
    const gesture = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': ['G'] } },
      'gesture-g',
      async (context) =>
        harness.transport.commit({
          baseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          changes: context.editorChanges!,
        }),
    );

    const generatorSpy = vi.fn((latest: EditorDocumentV1) => ({
      schemaVersion: 1 as const,
      keyPositions: imageRecordFrom(latest),
    }));
    const generated = harness.coordinator.commitGeneratedPatch(generatorSpy);

    // 게스처가 정산되기 전에는 생성하지 않는다
    await Promise.resolve();
    await Promise.resolve();
    expect(generatorSpy).not.toHaveBeenCalled();

    gate.resolve();
    await gesture;
    await generated;

    // 생성 base에 게스처 결과가 이미 반영돼 있다
    expect(generatorSpy.mock.calls[0][0].keys['4key']).toEqual(['G']);
    const finalDocument = harness.transport.canonical.document;
    expect(finalDocument.keys['4key']).toEqual(['G']);
    expect(finalDocument.keyPositions['4key'][0].inactiveImage).toBe(
      'generated.png',
    );
    harness.coordinator.stop();
  });

  it('격리 플러그인 커밋 선행 시 그 결과 위에서 생성한다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    const gate = deferred<void>();
    gatedDefaultCommit(harness, gate.promise);
    const isolated = harness.coordinator.commitIsolatedPluginPatch(
      { schemaVersion: 1, keys: { '4key': ['P'] } },
      { multiKey: false },
    );

    const generatorSpy = vi.fn((latest: EditorDocumentV1) => ({
      schemaVersion: 1 as const,
      keyPositions: imageRecordFrom(latest),
    }));
    const generated = harness.coordinator.commitGeneratedPatch(generatorSpy);

    gate.resolve();
    await isolated;
    await generated;

    expect(generatorSpy.mock.calls[0][0].keys['4key']).toEqual(['P']);
    const finalDocument = harness.transport.canonical.document;
    expect(finalDocument.keys['4key']).toEqual(['P']);
    expect(finalDocument.keyPositions['4key'][0].inactiveImage).toBe(
      'generated.png',
    );
    harness.coordinator.stop();
  });

  it('compatibility 큐 선행 writer의 stale 레코드와 생성 커밋이 모두 생존한다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    // C가 큐 점유 - X는 클릭 전 캡처한 full record를 들고 대기
    const releaseC = deferred<void>();
    const cDone = enqueueEditorCompatibilityWrite(
      () => releaseC.promise,
      () => undefined,
    );
    const staleRecord = structuredClone(
      harness.transport.canonical.document.keyPositions,
    );
    staleRecord['4key'] = staleRecord['4key'].map((position, index) =>
      index === 0 ? { ...position, noteWidth: 222 } : position,
    );
    const xDone = enqueueEditorCompatibilityWrite(
      () =>
        harness.coordinator.commitPatch({
          schemaVersion: 1,
          keyPositions: staleRecord,
        }),
      () => undefined,
    );

    // 생성 커밋도 같은 큐에 합류 - 큐를 건너뛰면 X가 나중에 실행되어
    // 생성 값을 되돌린다
    const bDone = enqueueEditorCompatibilityWrite(
      () =>
        harness.coordinator.commitGeneratedPatch((latest) => ({
          schemaVersion: 1,
          keyPositions: imageRecordFrom(latest),
        })),
      () => undefined,
    );

    releaseC.resolve();
    await Promise.all([cDone, xDone, bDone]);

    const finalPosition =
      harness.transport.canonical.document.keyPositions['4key'][0];
    expect(finalPosition.noteWidth).toBe(222);
    expect(finalPosition.inactiveImage).toBe('generated.png');
    harness.coordinator.stop();
  });

  it('선행 커밋이 대상을 삭제하면 생성이 null로 수렴해 커밋하지 않는다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();
    const targetId =
      harness.transport.canonical.document.keyPositions['4key'][0].id;

    const gate = deferred<void>();
    gatedDefaultCommit(harness, gate.promise);
    const deletion = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': [] }, keyPositions: { '4key': [] } },
      'gesture-delete',
      async (context) =>
        harness.transport.commit({
          baseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          changes: context.editorChanges!,
        }),
    );

    const generatorSpy = vi.fn((latest: EditorDocumentV1) => {
      const found = latest.keyPositions['4key']?.some(
        (position) => position.id === targetId,
      );
      if (!found) return null;
      return {
        schemaVersion: 1 as const,
        keyPositions: imageRecordFrom(latest),
      };
    });
    const generated = harness.coordinator.commitGeneratedPatch(generatorSpy);

    gate.resolve();
    await deletion;
    await generated;

    // 생성은 삭제가 반영된 base를 받아 null로 수렴한다
    expect(generatorSpy.mock.calls[0][0].keyPositions['4key']).toEqual([]);
    // wire 커밋은 삭제 1건뿐, revision도 그만큼만 전진
    expect(harness.transport.commitMock).toHaveBeenCalledTimes(1);
    expect(harness.transport.canonical.revision).toBe(1);
    expect(harness.transport.canonical.document.keyPositions['4key']).toEqual(
      [],
    );
    harness.coordinator.stop();
  });

  it('생성 커밋의 gestureId가 wire 요청에 실린다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    await harness.coordinator.commitGeneratedPatch(
      (latest) => ({
        schemaVersion: 1,
        keyPositions: imageRecordFrom(latest),
      }),
      { gestureId: 'gesture-generated' },
    );

    const request = harness.transport.commitMock.mock.calls.at(-1)?.[0];
    expect(request?.gestureIds).toEqual(['gesture-generated']);
    harness.coordinator.stop();
  });

  it('null 생성은 mutation·낙관 적용·revision 전진이 전부 없다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    const commitsBefore = harness.transport.commitMock.mock.calls.length;
    const applicationsBefore = harness.applications.length;
    const revisionBefore = harness.transport.canonical.revision;

    const result = await harness.coordinator.commitGeneratedPatch(() => null);

    expect(harness.transport.commitMock.mock.calls.length).toBe(commitsBefore);
    expect(harness.applications.length).toBe(applicationsBefore);
    expect(harness.transport.canonical.revision).toBe(revisionBefore);
    expect(result).toEqual(base);
    harness.coordinator.stop();
  });

  it('생성 후 revision 충돌은 비중첩 rebase로 양쪽을 보존한다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    harness.transport.commitMock.mockImplementationOnce(async () => {
      // 외부 writer가 먼저 revision을 전진시킨 상황
      harness.transport.canonical.revision += 1;
      harness.transport.canonical.document = applyEditorPatch(
        harness.transport.canonical.document,
        { schemaVersion: 1, keys: { '4key': ['EXT'] } },
      );
      throw revisionConflict();
    });

    await harness.coordinator.commitGeneratedPatch((latest) => ({
      schemaVersion: 1,
      keyPositions: imageRecordFrom(latest),
    }));

    const finalDocument = harness.transport.canonical.document;
    expect(finalDocument.keys['4key']).toEqual(['EXT']);
    expect(finalDocument.keyPositions['4key'][0].inactiveImage).toBe(
      'generated.png',
    );
    harness.coordinator.stop();
  });

  it('배타 legacy mutation은 in-flight 커밋 완료 후 실행되고 canonical을 재동기화한다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    const gate = deferred<void>();
    gatedDefaultCommit(harness, gate.promise);
    const gesture = harness.coordinator.commitGesture(
      { schemaVersion: 1, keys: { '4key': ['G'] } },
      'gesture-g',
      async (context) =>
        harness.transport.commit({
          baseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          changes: context.editorChanges!,
        }),
    );

    const mutationSpy = vi.fn(async () => {
      // 백엔드가 문서를 직접 바꾸는 legacy 커맨드 흉내
      const before = harness.transport.canonical.document;
      harness.transport.canonical.document = applyEditorPatch(before, {
        schemaVersion: 1,
        keys: { '4key': ['L'] },
      });
      harness.transport.canonical.revision += 1;
      return 'mutated';
    });
    const exclusive =
      harness.coordinator.runExclusiveLegacyMutation(mutationSpy);

    await Promise.resolve();
    await Promise.resolve();
    expect(mutationSpy).not.toHaveBeenCalled();

    gate.resolve();
    await gesture;
    const result = await exclusive;

    expect(result).toBe('mutated');
    // 슬롯 안 재동기화로 로컬 문서가 mutation 결과를 반영
    expect(harness.getLocal().keys['4key']).toEqual(['L']);

    // 이후 자사 커밋은 mutation 결과 위에서 진행
    await harness.coordinator.commitPatch({
      schemaVersion: 1,
      keyPositions: imageRecordFrom(harness.getLocal()),
    });
    const finalDocument = harness.transport.canonical.document;
    expect(finalDocument.keys['4key']).toEqual(['L']);
    expect(finalDocument.keyPositions['4key'][0].inactiveImage).toBe(
      'generated.png',
    );
    harness.coordinator.stop();
  });

  it('선행 stale compat write와 후행 generated가 배타 mutation 결과를 되돌리지 않는다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    // 선행 writer: 클릭 시점 캡처된 stale full record (compat 큐 대기)
    const releaseC = deferred<void>();
    const gate = enqueueEditorCompatibilityWrite(
      () => releaseC.promise,
      () => undefined,
    );
    const staleRecord = structuredClone(
      harness.transport.canonical.document.keyPositions,
    );
    staleRecord['4key'] = staleRecord['4key'].map((position, index) =>
      index === 0 ? { ...position, noteWidth: 111 } : position,
    );
    const staleWrite = enqueueEditorCompatibilityWrite(
      () =>
        harness.coordinator.commitPatch({
          schemaVersion: 1,
          keyPositions: staleRecord,
        }),
      () => undefined,
    );

    // 배타 legacy mutation (compat 큐 + 직렬 tail 점유)
    const legacy = enqueueEditorCompatibilityOperation(() =>
      harness.coordinator.runExclusiveLegacyMutation(async () => {
        harness.transport.canonical.document = applyEditorPatch(
          harness.transport.canonical.document,
          { schemaVersion: 1, keys: { '4key': ['L'] } },
        );
        harness.transport.canonical.revision += 1;
        return 'mutated';
      }),
    );

    // 후행 generated
    const generated = enqueueEditorCompatibilityOperation(() =>
      harness.coordinator.commitGeneratedPatch((latest) => ({
        schemaVersion: 1,
        keyPositions: imageRecordFrom(latest),
      })),
    );

    releaseC.resolve();
    await Promise.all([gate, staleWrite, legacy, generated]);

    const finalDocument = harness.transport.canonical.document;
    // 셋 다 생존: stale write 값, mutation 결과, generated 값
    expect(finalDocument.keyPositions['4key'][0].noteWidth).toBe(111);
    expect(finalDocument.keys['4key']).toEqual(['L']);
    expect(finalDocument.keyPositions['4key'][0].inactiveImage).toBe(
      'generated.png',
    );
    harness.coordinator.stop();
  });

  it('배타 mutation 실패는 원 오류로 전파되고 tail은 계속 진행된다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    await expect(
      harness.coordinator.runExclusiveLegacyMutation(async () => {
        throw new Error('legacy failed');
      }),
    ).rejects.toThrow('legacy failed');

    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: { '4key': ['N'] },
      }),
    ).resolves.toBeTruthy();
    harness.coordinator.stop();
  });

  it('배타 mutation 재동기화 실패는 mutation 성공을 뒤집지 않는다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.transport.getMock.mockRejectedValueOnce(
      new Error('ipc unavailable'),
    );

    const result = await harness.coordinator.runExclusiveLegacyMutation(
      async () => 'ok',
    );

    expect(result).toBe('ok');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    harness.coordinator.stop();
  });

  it('generator 예외는 해당 커밋만 실패시키고 큐는 계속 진행된다', async () => {
    const base = makeDocument('A');
    const harness = createHarness(base);
    await harness.coordinator.start();

    await expect(
      harness.coordinator.commitGeneratedPatch(() => {
        throw new Error('generator failed');
      }),
    ).rejects.toThrow('generator failed');

    await expect(
      harness.coordinator.commitPatch({
        schemaVersion: 1,
        keys: { '4key': ['N'] },
      }),
    ).resolves.toBeTruthy();
    expect(harness.transport.canonical.document.keys['4key']).toEqual(['N']);
    harness.coordinator.stop();
  });
});

describe('commitSemanticOpsInternal', () => {
  const withStableId = (id: string): EditorDocumentV1 => {
    const document = makeDocument();
    document.keyPositions['4key'][0] = {
      ...document.keyPositions['4key'][0],
      id,
    };
    return document;
  };

  const setBoundsOp = (id: string): EditorOpV1 => ({
    kind: 'setBounds',
    elementType: 'key',
    id,
    bounds: { dx: 12, dy: 13, width: 140, height: 150 },
  });

  it('ordered opResults로 정확한 base의 lastAck를 갱신한다', async () => {
    const id = '00000000-0000-4000-8000-000000000100';
    const harness = createHarness(withStableId(id));
    await harness.coordinator.start();

    const outcome = await harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);

    expect(outcome.opResults).toEqual([
      { status: 'applied', bounds: setBoundsOp(id).bounds },
    ]);
    expect(outcome.document.keyPositions['4key'][0]).toMatchObject(
      setBoundsOp(id).bounds,
    );
    expect(harness.transport.getMock).toHaveBeenCalledOnce();
    expect(harness.transport.commitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        opsVersion: 1,
        ops: [setBoundsOp(id)],
      }),
    );
    expect(harness.transport.commitMock.mock.calls[0][0]).not.toHaveProperty(
      'changes',
    );
    harness.coordinator.stop();
  });

  it('직렬 슬롯 선행 커밋이 eager를 지워도 semantic op를 최신 화면에 다시 적용한다', async () => {
    const id = '00000000-0000-4000-8000-000000000110';
    const base = withStableId(id);
    const harness = createHarness(base);
    await harness.coordinator.start();
    const gate = deferred<EditorCommitResult>();
    const original = harness.transport.commitMock.getMockImplementation()!;
    harness.transport.commitMock
      .mockImplementationOnce(() => gate.promise)
      .mockImplementation(original);

    const first = harness.coordinator.commitPatch({
      schemaVersion: 1,
      keys: { '4key': ['B'] },
    });
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );
    harness.setLocal(applyOpsForTest(harness.getLocal(), [setBoundsOp(id)]));
    const semantic = harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);

    const firstRequest = harness.transport.commitMock.mock.calls[0][0];
    const firstResult = await original(firstRequest);
    const firstCanonical = structuredClone(
      harness.transport.canonical.document,
    );
    harness.setLocal(firstCanonical);
    expect(harness.getLocal().keyPositions['4key'][0]).not.toMatchObject(
      setBoundsOp(id).bounds,
    );
    gate.resolve(firstResult);
    await first;
    await semantic;

    expect(harness.getLocal().keys['4key']).toEqual(['B']);
    expect(harness.getLocal().keyPositions['4key'][0]).toMatchObject(
      setBoundsOp(id).bounds,
    );
    harness.coordinator.stop();
  });

  it('진행 중인 gesture 정산이 끝난 뒤 semantic op를 실행한다', async () => {
    const id = '00000000-0000-4000-8000-000000000112';
    const harness = createHarness(withStableId(id));
    await harness.coordinator.start();
    const gate = deferred<EditorCommitResult>();
    const gesture = harness.coordinator.commitGesture(
      undefined,
      'active-gesture',
      () => gate.promise,
    );
    await Promise.resolve();

    const semantic = harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);
    await Promise.resolve();
    expect(harness.transport.commitMock).not.toHaveBeenCalled();

    gate.resolve({ revision: 0, changedFields: [] });
    await gesture;
    await semantic;

    expect(harness.transport.commitMock).toHaveBeenCalledOnce();
    expect(harness.transport.commitMock.mock.calls[0][0]).toMatchObject({
      opsVersion: 1,
      ops: [setBoundsOp(id)],
    });
    harness.coordinator.stop();
  });

  it('IO 결과 미상은 같은 envelope로 한 번만 재전송한다', async () => {
    const id = '00000000-0000-4000-8000-000000000101';
    const harness = createHarness(withStableId(id));
    await harness.coordinator.start();
    const original = harness.transport.commitMock.getMockImplementation()!;
    harness.transport.commitMock
      .mockRejectedValueOnce(ioError())
      .mockImplementationOnce(original);

    await harness.coordinator.commitSemanticOpsInternal([setBoundsOp(id)]);

    expect(harness.transport.commitMock).toHaveBeenCalledTimes(2);
    expect(harness.transport.commitMock.mock.calls[0][0]).toEqual(
      harness.transport.commitMock.mock.calls[1][0],
    );
    harness.coordinator.stop();
  });

  it('IO 응답 유실 뒤 replay도 같은 mutationId를 사용한다', async () => {
    const id = '00000000-0000-4000-8000-000000000105';
    const harness = createHarness(withStableId(id));
    await harness.coordinator.start();
    const original = harness.transport.commitMock.getMockImplementation()!;
    let acknowledged: EditorCommitResult | null = null;
    harness.transport.commitMock
      .mockImplementationOnce(async (request) => {
        acknowledged = await original(request);
        throw ioError();
      })
      .mockImplementationOnce(async () => structuredClone(acknowledged!));

    const outcome = await harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);

    expect(outcome.document.keyPositions['4key'][0]).toMatchObject(
      setBoundsOp(id).bounds,
    );
    expect(harness.transport.commitMock.mock.calls[0][0]).toEqual(
      harness.transport.commitMock.mock.calls[1][0],
    );
    harness.coordinator.stop();
  });

  it('두 번째 IO 실패 뒤 canonical을 동기화하고 transient로 끝낸다', async () => {
    const id = '00000000-0000-4000-8000-000000000106';
    const onGestureIdsDiscarded = vi.fn();
    const harness = createHarness(withStableId(id), {
      onGestureIdsDiscarded,
    });
    await harness.coordinator.start();
    harness.transport.commitMock.mockRejectedValue(ioError());

    await expect(
      harness.coordinator.commitSemanticOpsInternal([setBoundsOp(id)], {
        gestureId: 'io-preview',
      }),
    ).rejects.toMatchObject({ errorCode: 'IO_ERROR' });

    expect(harness.transport.commitMock).toHaveBeenCalledTimes(2);
    expect(harness.transport.commitMock.mock.calls[0][0]).toEqual(
      harness.transport.commitMock.mock.calls[1][0],
    );
    expect(harness.transport.getMock).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'error',
      failureKind: 'transient',
      dirty: false,
    });
    expect(onGestureIdsDiscarded).toHaveBeenCalledWith(['io-preview']);
    harness.coordinator.stop();
  });

  it('revision conflict는 canonical마다 새 mutationId로 최대 두 번 재시도한다', async () => {
    const id = '00000000-0000-4000-8000-000000000102';
    const base = withStableId(id);
    const onGestureIdsDiscarded = vi.fn();
    const harness = createHarness(base, { onGestureIdsDiscarded });
    await harness.coordinator.start();
    harness.transport.commitMock.mockRejectedValue(revisionConflict());
    harness.transport.getMock.mockImplementation(async () => {
      harness.transport.canonical.revision += 1;
      return structuredClone(harness.transport.canonical);
    });

    await expect(
      harness.coordinator.commitSemanticOpsInternal([setBoundsOp(id)], {
        gestureId: 'conflict-preview',
      }),
    ).rejects.toMatchObject({ errorCode: 'REVISION_CONFLICT' });

    expect(harness.transport.commitMock).toHaveBeenCalledTimes(3);
    expect(
      harness.transport.commitMock.mock.calls.map(
        ([request]) => request.mutationId,
      ),
    ).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]);
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'error',
      failureKind: 'transient',
      dirty: false,
    });
    expect(onGestureIdsDiscarded).toHaveBeenCalledWith(['conflict-preview']);
    harness.coordinator.stop();
  });

  it('targetMissing은 성공 후 canonical을 한 번 읽고 정상 결과로 끝낸다', async () => {
    const id = '00000000-0000-4000-8000-000000000103';
    const harness = createHarness(withStableId(id));
    await harness.coordinator.start();
    harness.transport.commitMock.mockResolvedValueOnce({
      revision: 0,
      changedFields: [],
      opResults: [{ status: 'targetMissing' }],
    });

    const outcome = await harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);

    expect(outcome.opResults).toEqual([{ status: 'targetMissing' }]);
    expect(harness.transport.getMock).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.getState().phase).toBe('idle');
    harness.coordinator.stop();
  });

  it('noChange는 revision을 올리지 않고 canonical bounds를 반환한다', async () => {
    const id = '00000000-0000-4000-8000-000000000111';
    const base = withStableId(id);
    Object.assign(base.keyPositions['4key'][0], setBoundsOp(id).bounds);
    const harness = createHarness(base);
    await harness.coordinator.start();

    const outcome = await harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);

    expect(outcome.opResults).toEqual([
      { status: 'noChange', bounds: setBoundsOp(id).bounds },
    ]);
    expect(harness.transport.canonical.revision).toBe(0);
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'idle',
      dirty: false,
    });
    harness.coordinator.stop();
  });

  it('opResults의 applied 집합과 다른 changedFields를 영구 protocol 오류로 거절한다', async () => {
    const id = '00000000-0000-4000-8000-000000000107';
    const harness = createHarness(withStableId(id));
    await harness.coordinator.start();
    harness.transport.commitMock.mockResolvedValueOnce({
      revision: 1,
      changedFields: [],
      opResults: [{ status: 'applied', bounds: setBoundsOp(id).bounds }],
    });

    await expect(
      harness.coordinator.commitSemanticOpsInternal([setBoundsOp(id)]),
    ).rejects.toBeInstanceOf(EditorProtocolError);
    expect(harness.transport.commitMock).toHaveBeenCalledOnce();
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'error',
      failureKind: 'permanent',
    });
    harness.coordinator.stop();
  });

  it('semantic op 영구 거절은 결합된 preview gesture를 폐기한다', async () => {
    const id = '00000000-0000-4000-8000-000000000108';
    const onGestureIdsDiscarded = vi.fn();
    const harness = createHarness(withStableId(id), {
      onGestureIdsDiscarded,
    });
    await harness.coordinator.start();
    harness.transport.commitMock.mockRejectedValueOnce(validationError());

    await expect(
      harness.coordinator.commitSemanticOpsInternal([setBoundsOp(id)], {
        gestureId: 'semantic-preview',
      }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });

    expect(onGestureIdsDiscarded).toHaveBeenCalledWith(['semantic-preview']);
    harness.coordinator.stop();
  });

  it('semantic op 진행 중 외부 이벤트는 일반 pending으로 중복 승격하지 않는다', async () => {
    const id = '00000000-0000-4000-8000-000000000109';
    const base = withStableId(id);
    const harness = createHarness(base);
    await harness.coordinator.start();
    const gate = deferred<EditorCommitResult>();
    harness.transport.commitMock.mockImplementationOnce(() => gate.promise);

    const committing = harness.coordinator.commitSemanticOpsInternal([
      setBoundsOp(id),
    ]);
    await vi.waitFor(() =>
      expect(harness.transport.commitMock).toHaveBeenCalledOnce(),
    );

    const external = structuredClone(base);
    external.keys['4key'][0] = 'B';
    harness.transport.canonical = { revision: 1, document: external };
    harness.transport.emit(eventFor(1, 'external', base, external));
    await vi.waitFor(() =>
      expect(harness.coordinator.getState().revision).toBe(1),
    );

    gate.reject(revisionConflict());
    await expect(committing).resolves.toMatchObject({
      document: {
        keys: { '4key': ['B'] },
        keyPositions: {
          '4key': [expect.objectContaining(setBoundsOp(id).bounds)],
        },
      },
    });
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'idle',
      dirty: false,
      conflict: null,
    });
    harness.coordinator.stop();
  });

  it('conflict canonical 조회 실패도 transient error로 정산한다', async () => {
    const id = '00000000-0000-4000-8000-000000000104';
    const onGestureIdsDiscarded = vi.fn();
    const harness = createHarness(withStableId(id), {
      onGestureIdsDiscarded,
    });
    await harness.coordinator.start();
    const syncError = new Error('canonical unavailable');
    harness.transport.commitMock.mockRejectedValueOnce(revisionConflict());
    harness.transport.getMock.mockRejectedValueOnce(syncError);

    await expect(
      harness.coordinator.commitSemanticOpsInternal([setBoundsOp(id)], {
        gestureId: 'sync-preview',
      }),
    ).rejects.toBe(syncError);
    expect(harness.coordinator.getState()).toMatchObject({
      phase: 'error',
      failureKind: 'transient',
      dirty: false,
    });
    expect(onGestureIdsDiscarded).toHaveBeenCalledWith(['sync-preview']);
    harness.coordinator.stop();
  });
});
