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

import type {
  EditorCommitError,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorDocumentV1,
  EditorGetResult,
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
      const next = applyEditorPatch(before, request.changes);
      const changedFields = getChangedEditorFields(before, next);
      if (changedFields.length > 0) this.canonical.revision += 1;
      this.canonical.document = next;
      return {
        revision: this.canonical.revision,
        changedFields,
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

  // 백엔드 v1 adapter 흉내: 무ID keyPositions에 canonical의 ID를 되살린다.
  // 결과 envelope에는 adapted 값이 없으므로 coordinator는 get으로만 알 수 있다
  const emulateV1AdapterCommit = (
    harness: ReturnType<typeof createHarness>,
  ) => {
    harness.transport.commitMock.mockImplementation(async (request) => {
      const before = harness.transport.canonical.document;
      const next = applyEditorPatch(before, request.changes);
      for (const [mode, positions] of Object.entries(next.keyPositions)) {
        positions.forEach((position, index) => {
          if (!position.id) {
            const inherited = before.keyPositions[mode]?.[index]?.id;
            if (inherited) position.id = inherited;
          }
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

  it('keeps canonical element ids after a changing idless plugin commit', async () => {
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

    // own committed 이벤트는 revision 선점으로 패치가 무시되므로,
    // 커밋 경로 자체가 canonical(ID 포함)을 되찾아야 한다
    expect(result.keyPositions['4key'][0].dx).toBe(moved['4key'][0].dx);
    expect(result.keyPositions['4key'][0].id).toBe(idBefore);
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);
  });

  it('keeps the previous canonical when the post-commit read fails and recovers on retry', async () => {
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
    await expect(
      harness.coordinator.commitIsolatedPluginPatch(
        { schemaVersion: 1, keys: base.keys, keyPositions: moved },
        { multiKey: false },
      ),
    ).rejects.toThrow('ipc unavailable');

    // 무ID target이 lastAck·스토어를 오염시키지 않는다 (이전 canonical 유지)
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);
    expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
      base.keyPositions['4key'][0].dx,
    );

    // coordinator는 죽은 상태가 아니다 - 재시도가 정상 경로로 복구된다
    const retried = await harness.coordinator.commitIsolatedPluginPatch(
      { schemaVersion: 1, keys: base.keys, keyPositions: moved },
      { multiKey: false },
    );
    expect(retried.keyPositions['4key'][0].id).toBe(idBefore);
    expect(retried.keyPositions['4key'][0].dx).toBe(moved['4key'][0].dx);
    expect(harness.getLocal().keyPositions['4key'][0].dx).toBe(
      moved['4key'][0].dx,
    );
    harness.coordinator.stop();
  });

  it('recovers the local store from the own event after a failed post-commit read', async () => {
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
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);

    // 후속 flush가 성공한 플러그인 변경을 낡은 로컬로 되돌리지 않는다
    const commitsBefore = harness.transport.commitMock.mock.calls.length;
    await harness.coordinator.commitEditorState();
    expect(harness.transport.commitMock.mock.calls.length).toBe(commitsBefore);
    harness.coordinator.stop();
  });

  it('recovers the local store when the own event lands before the failed read', async () => {
    const base = makeDocument('A');
    const idBefore = base.keyPositions['4key'][0].id;
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
    expect(harness.getLocal().keyPositions['4key'][0].id).toBe(idBefore);

    const commitsBefore = harness.transport.commitMock.mock.calls.length;
    await harness.coordinator.commitEditorState();
    expect(harness.transport.commitMock.mock.calls.length).toBe(commitsBefore);
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
