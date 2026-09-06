import { retainPendingGestureIds } from './pendingGestureIds';
import {
  planEditorRebase,
  assertSemanticChangedFields,
} from './editorReconciliation';
import {
  applySemanticOps,
  fieldsForSemanticOp,
} from '../projection/semanticOpsProjection';
import { SerialTaskQueue } from './serialTaskQueue';
import { hasReachedEditorAutoRebaseLimit } from './editorRetryPolicy';
import {
  runSemanticCommitAttemptRuntime,
  type EditorSemanticCommitMeta,
  type EditorSemanticCommitOutcome,
  type EditorSemanticOpsGenerator,
} from './semanticCommitAttemptRuntime';
import {
  applyEditorPatch,
  applyIsolatedPluginPatch,
  canReapplyFrozenOp,
  clone,
  frozenPatchOwnedFields,
  getChangedEditorFields,
  patchForFields,
  rebaseEditorDocument,
} from './editorRebaseModel';

export {
  applyEditorPatch,
  createEditorPatch,
  getChangedEditorFields,
} from './editorRebaseModel';

import {
  EDITOR_COMMIT_SCHEMA_VERSION,
  EDITOR_FIELDS,
  EDITOR_OPS_VERSION,
  EditorProtocolError,
  assertEditorCommitResult,
  assertEditorCommittedEvent,
  assertCanonicalEditorDocument,
  assertEditorGetResult,
  assertEditorOpCommitResult,
  assertEditorOpsV1,
  assertEditorPatch,
  canonicalizeEditorGradients,
  isEditorCommitError,
  isRetryableEditorCommitError,
} from '@src/types/editor';

import type {
  EditorCommitError,
  EditorCommitResult,
  EditorCommittedV1,
  CanonicalEditorDocumentV1,
  EditorField,
  CanonicalEditorGetResult,
  EditorGestureCommitContext,
  EditorLegacyPatchV1,
  EditorOpResultV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';

import type {
  EditorApplyReason,
  EditorConflictResolution,
  EditorConflictState,
  EditorCoordinatorPhase,
  EditorCoordinatorState,
  EditorReadyUnsubscribe,
  EditorGestureOpsMutation,
  EditorGestureMutation,
  EditorCoordinatorTransport,
  EditorEventTarget,
  EditorVisibilityTarget,
  EditorCoordinatorOptions,
  EditorSyncOptions,
  InFlightCommit,
} from './editorCoordinatorTypes';
export type {
  EditorApplyReason,
  EditorCoordinatorState,
  EditorReadyUnsubscribe,
  EditorPatchGenerator,
  EditorGestureOpsMutation,
  EditorCoordinatorTransport,
  EditorCoordinatorOptions,
} from './editorCoordinatorTypes';

export type {
  EditorSemanticCommitMeta,
  EditorSemanticCommitOutcome,
  EditorSemanticOpsGenerator,
} from './semanticCommitAttemptRuntime';

const isGestureOpsMutation = (
  mutation: EditorGestureMutation | null,
): mutation is EditorGestureOpsMutation =>
  typeof mutation === 'object' && mutation !== null && 'opsVersion' in mutation;

export class EditorReadOnlyError extends Error {
  constructor() {
    super('editor coordinator is read-only');
    this.name = 'EditorReadOnlyError';
  }
}

const MAX_TRACKED_MUTATIONS = 64;

class EditorSaveCoordinator {
  private readonly transport: EditorCoordinatorTransport;
  private readonly readDocument: () => CanonicalEditorDocumentV1;
  private readonly applyDocument: EditorCoordinatorOptions['applyDocument'];
  private readonly createMutationId: () => string;
  private readonly focusTarget: EditorEventTarget | null;
  private readonly visibilityTarget: EditorVisibilityTarget | null;
  private readonly isReadOnly: () => boolean;
  private readonly onCommittedApplied:
    | ((event: EditorCommittedV1) => void)
    | null;
  private readonly onGestureIdsDiscarded:
    | ((gestureIds: readonly string[]) => void)
    | null;
  private readonly onStartSucceeded: (() => void | Promise<void>) | null;

  private phase: EditorCoordinatorPhase = 'idle';
  private revision: number | null = null;
  private lastAck: CanonicalEditorDocumentV1 | null = null;
  private pendingLocal: CanonicalEditorDocumentV1 | null = null;
  private pendingFields: EditorField[] = [];
  private pendingRequestFields: EditorField[] = [];
  private inFlight: InFlightCommit | null = null;
  // 커밋 의도 시점에 캡처된 게스처 ID 집합
  private pendingGestureIds: string[] = [];
  private conflict: EditorConflictState | null = null;
  private error: unknown = null;
  private failureKind: 'transient' | 'permanent' | null = null;
  private stopped = false;
  private initializing = false;

  private startPromise: Promise<CanonicalEditorGetResult> | null = null;
  private drainPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private eventQueue = new SerialTaskQueue();
  private serializedCommitQueue = new SerialTaskQueue();
  private unsubscribeCommitted: EditorReadyUnsubscribe | null = null;
  private bufferedEvents: EditorCommittedV1[] = [];
  private ownMutations = new Set<string>();
  // 낙관 적용 없이 커밋되는 격리 플러그인 mutation. own 이벤트가 도착하면
  // store 적용까지 필요하다는 표시
  private isolatedMutations = new Set<string>();
  private listeners = new Set<(state: EditorCoordinatorState) => void>();

  private readonly handleFocus = () => {
    void this.sync().catch((error) => this.recordBackgroundError(error));
  };

  private readonly handleVisibilityChange = () => {
    if (this.visibilityTarget?.visibilityState !== 'hidden') {
      void this.sync().catch((error) => this.recordBackgroundError(error));
    }
  };

  constructor(options: EditorCoordinatorOptions) {
    this.transport = options.transport;
    this.readDocument = options.readDocument;
    this.applyDocument = options.applyDocument;
    this.onCommittedApplied = options.onCommittedApplied ?? null;
    this.onGestureIdsDiscarded = options.onGestureIdsDiscarded ?? null;
    this.onStartSucceeded = options.onStartSucceeded ?? null;
    this.createMutationId =
      options.createMutationId ?? (() => crypto.randomUUID());
    this.focusTarget =
      options.focusTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.focusTarget;
    this.visibilityTarget =
      options.visibilityTarget === undefined
        ? typeof document === 'undefined'
          ? null
          : document
        : options.visibilityTarget;
    const readOnly = options.readOnly;
    this.isReadOnly =
      typeof readOnly === 'function' ? readOnly : () => readOnly ?? false;
  }

  getState(): EditorCoordinatorState {
    const latestPending = this.getLatestPendingDocument();
    return {
      phase: this.phase,
      revision: this.revision,
      dirty: latestPending !== null,
      inFlightMutationId: this.inFlight?.mutationId ?? null,
      lastAck: this.lastAck ? clone(this.lastAck) : null,
      pendingLocal: latestPending ? clone(latestPending) : null,
      conflict: this.conflict ? clone(this.conflict) : null,
      error: this.error,
      failureKind: this.failureKind,
    };
  }

  subscribe(listener: (state: EditorCoordinatorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<CanonicalEditorGetResult> {
    if (this.stopped) {
      return Promise.reject(new Error('editor coordinator is stopped'));
    }
    if (!this.startPromise) {
      this.startPromise = this.initialize().catch((error) => {
        this.startPromise = null;
        this.initializing = false;
        this.phase = 'error';
        this.error = error;
        this.detachLifecycle();
        this.unsubscribeCommitted?.();
        this.unsubscribeCommitted = null;
        this.notify();
        throw error;
      });
    }
    return this.startPromise.then(async (result) => {
      await this.onStartSucceeded?.();
      return result;
    });
  }

  async commitEditorState(
    document?: CanonicalEditorDocumentV1,
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    // gradient canonical 정규화를 assert 앞에 — 이후 diff·invoke가 같은 값 사용
    const currentDocument = canonicalizeEditorGradients(
      document ?? this.readDocument(),
    );
    assertCanonicalEditorDocument(currentDocument);
    const snapshot = clone(currentDocument);

    const projected = this.getLatestCommitBase();
    const newIntentFields = getChangedEditorFields(projected, snapshot);
    return this.queueSnapshot(snapshot, newIntentFields, []);
  }

  private async queueSnapshot(
    snapshot: CanonicalEditorDocumentV1,
    newIntentFields: readonly EditorField[],
    requestFields: readonly EditorField[],
    gestureId?: string,
    onEnrolled?: () => void,
  ): Promise<CanonicalEditorDocumentV1> {
    if (gestureId) {
      this.replacePendingGestureIds([...this.pendingGestureIds, gestureId]);
    }
    if (this.conflict) {
      const conflict = this.conflict;
      const newlyChangedFields = getChangedEditorFields(
        conflict.pendingLocal,
        snapshot,
      );
      conflict.pendingLocal = snapshot;
      conflict.localFields = EDITOR_FIELDS.filter(
        (field) =>
          conflict.localFields.includes(field) ||
          newlyChangedFields.includes(field),
      );
      // conflict pendingLocal에 실제 편입 완료 - keepLocal 해소가 소유
      onEnrolled?.();
      this.notify();
      return Promise.reject(this.error ?? new Error('editor conflict pending'));
    }

    const outstandingFields = new Set<EditorField>([
      ...(this.optimisticInFlight()?.localFields ?? []),
      ...this.pendingFields,
      ...newIntentFields,
    ]);
    this.pendingLocal = snapshot;
    this.pendingFields = EDITOR_FIELDS.filter((field) =>
      outstandingFields.has(field),
    );
    const requested = new Set<EditorField>([
      ...this.pendingRequestFields,
      ...requestFields,
    ]);
    this.pendingRequestFields = EDITOR_FIELDS.filter((field) =>
      requested.has(field),
    );
    // pending에 실제 편입 완료 - 이후 실패는 재시도·거절 경로가 소유
    onEnrolled?.();
    this.error = null;
    this.failureKind = null;
    this.notify();
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async commitPatch(
    changes: EditorPatchV1,
    meta?: { gestureId?: string },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    return this.commitPatchSettled(changes, meta?.gestureId);
  }

  // 정산 착지 시 동결 의도의 낙관 재적용. 선행 커밋(격리 plugin 쓰기 등)의
  // canonical 적용이 호출 시점의 eager 값을 지운 경우 스토어를 복구하는
  // 경로다. 다만 슬롯 대기 중 시작된 2차 eager 편집이 같은 대상을 이미
  // 덮었을 수 있어 무조건 되쓰면 진행 중 편집이 동결값으로 되돌아간다.
  // gestureTransaction의 PERSISTED_FIELDS CAS와 같은 규약으로, 현재 값이
  // 동결 시점 base와 같아 소유가 증명된 조각만 되쓴다
  // (ops는 대상 요소 조각 단위, patch는 필드 단위)
  private reapplyFrozenIntent(
    base: CanonicalEditorDocumentV1,
    mutation: { ops?: readonly EditorOpV1[]; changes?: EditorPatchV1 },
  ): void {
    const currentDocument = this.readDocument();
    assertCanonicalEditorDocument(currentDocument, 'current editor document');
    const optimisticDocument = mutation.ops
      ? applySemanticOps(
          currentDocument,
          mutation.ops.filter((op) =>
            canReapplyFrozenOp(op, base, currentDocument),
          ),
        )
      : applyEditorPatch(
          currentDocument,
          frozenPatchOwnedFields(mutation.changes!, base, currentDocument),
        );
    if (
      getChangedEditorFields(currentDocument, optimisticDocument).length > 0
    ) {
      this.applyDocument(clone(optimisticDocument), 'localPatch');
    }
  }

  // 대기 이후 공통 본문. 슬롯 안에서 재사용하므로 여기서 tail을 다시
  // 기다리면 자기 슬롯 교착이 된다
  private commitPatchSettled(
    changes: EditorPatchV1,
    gestureId?: string,
    onEnrolled?: () => void,
  ): Promise<CanonicalEditorDocumentV1> {
    // gradient canonical 정규화를 assert 앞에 — optimistic·diff·invoke가 같은 값 사용
    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges);

    const projected = this.getLatestCommitBase();
    const target = applyEditorPatch(projected, canonicalChanges);
    assertCanonicalEditorDocument(target, 'projected editor document');
    const newIntentFields = getChangedEditorFields(projected, target);
    const requestFields = EDITOR_FIELDS.filter(
      (field) => canonicalChanges[field] !== undefined,
    );
    this.reapplyFrozenIntent(projected, { changes: canonicalChanges });
    return this.queueSnapshot(
      target,
      newIntentFields,
      requestFields,
      gestureId,
      onEnrolled,
    );
  }

  // 호출 시점 캡처 patch는 대기 중 정산된 다른 커밋의 같은 컬렉션 값을
  // 통째로 되돌린다. 컬렉션 전체 레코드를 보내야 하는 호출자는 이 경로로
  // 직렬 슬롯 안에서 최신 base를 받아 patch를 생성한다. null 반환은 무커밋
  // (mutation·낙관 적용·revision 전진 전부 없음)
  commitGeneratedPatch(
    generate: (base: CanonicalEditorDocumentV1) => EditorPatchV1 | null,
    meta?: { gestureId?: string; onEnrolled?: () => void },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(async () => {
      await this.start();
      await this.drainUntilSettled();
      await this.eventQueue.wait();
      const changes = generate(this.getLatestCommitBase());
      if (!changes) return clone(this.requireLastAck());
      // onEnrolled는 pending/conflict에 실제 편입된 직후 발화 - 호출자의
      // 롤백 판별 기준. 편입 전 종료(사전 실패·생성 예외·검증 실패)는
      // 어떤 기존 복원 경로도 이 intent를 소유하지 않는다
      return this.commitPatchSettled(
        changes,
        meta?.gestureId,
        meta?.onEnrolled,
      );
    });
  }

  commitSemanticOpsInternal(
    ops: readonly EditorOpV1[],
    meta: EditorSemanticCommitMeta = {},
  ): Promise<EditorSemanticCommitOutcome> {
    this.assertWritable();
    const frozenOps = clone([...ops]);
    try {
      assertEditorOpsV1(frozenOps);
      assertCanonicalEditorDocument(
        this.readDocument(),
        'current editor document',
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueueSerialized(async () => {
      const result = await this.commitGeneratedSemanticOpsInSlot(
        () => frozenOps,
        meta,
      );
      if (!result) {
        throw new EditorProtocolError(
          'fixed semantic ops generated no request',
        );
      }
      return result;
    });
  }

  commitGeneratedSemanticOpsInternal(
    generate: EditorSemanticOpsGenerator,
    meta: EditorSemanticCommitMeta = {},
  ): Promise<EditorSemanticCommitOutcome | null> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitGeneratedSemanticOpsInSlot(generate, meta),
    );
  }

  discardSemanticGesture(gestureId: string): void {
    this.onGestureIdsDiscarded?.([gestureId]);
  }

  private async commitGeneratedSemanticOpsInSlot(
    generate: EditorSemanticOpsGenerator,
    meta: EditorSemanticCommitMeta,
  ): Promise<EditorSemanticCommitOutcome | null> {
    return runSemanticCommitAttemptRuntime(generate, meta, {
      start: () => this.start(),
      drainUntilSettled: () => this.drainUntilSettled(),
      waitForEvents: () => this.eventQueue.wait(),
      readConflict: () => ({
        active: this.conflict !== null,
        error: this.error,
      }),
      readLastAck: () => this.requireLastAck(),
      readRevision: () => this.requireRevision(),
      readInFlightMutationId: () => this.inFlight?.mutationId ?? null,
      createMutationId: () => this.createMutationId(),
      setState: (patch) => {
        if ('inFlight' in patch) this.inFlight = patch.inFlight ?? null;
        if ('revision' in patch) this.revision = patch.revision ?? null;
        if ('lastAck' in patch) this.lastAck = patch.lastAck ?? null;
        if ('error' in patch) this.error = patch.error;
        if ('failureKind' in patch) {
          this.failureKind = patch.failureKind ?? null;
        }
        if ('phase' in patch && patch.phase) this.phase = patch.phase;
      },
      notify: () => this.notify(),
      applyDocument: (document, reason) => this.applyDocument(document, reason),
      reapplyFrozenIntent: (base, ops) =>
        this.reapplyFrozenIntent(base, { ops }),
      rememberOwnMutation: (inFlight) => this.rememberOwnMutation(inFlight),
      forgetOwnMutation: (mutationId) => this.ownMutations.delete(mutationId),
      discardGestureIds: (gestureIds) =>
        this.onGestureIdsDiscarded?.(gestureIds),
      commit: (request) => this.transport.commit(request),
      syncCanonical: () => this.syncSemanticCanonical(),
      assertChangedFields: (base, ops, opResults, result) =>
        assertSemanticChangedFields(base, ops, opResults, result),
      logCommit: (result, opResults, retryCount) =>
        this.logSemanticCommit(result, opResults, retryCount),
    });
  }

  private async syncSemanticCanonical(): Promise<CanonicalEditorGetResult> {
    const result = await this.transport.get();
    assertEditorGetResult(result);
    if (result.revision >= this.requireRevision()) {
      this.revision = result.revision;
      this.lastAck = clone(result.document);
      this.applyDocument(clone(result.document), 'resync');
      this.notify();
      return clone(result);
    }
    return {
      revision: this.requireRevision(),
      document: clone(this.requireLastAck()),
    };
  }

  private logSemanticCommit(
    result: EditorCommitResult,
    opResults: readonly EditorOpResultV1[],
    retryCount: number,
  ): void {
    const statusCounts = {
      applied: 0,
      noChange: 0,
      targetMissing: 0,
    };
    opResults.forEach(({ status }) => {
      statusCounts[status] += 1;
    });
    // semantic op 진단 지표
    // eslint-disable-next-line no-console
    console.info('[Editor] Commit completed', {
      mutationKind: 'ops',
      opCount: opResults.length,
      retryCount,
      revision: result.revision,
      ...statusCounts,
    });
  }

  // 백엔드가 문서를 직접 바꾸는 legacy 커맨드(프리셋 로드, 리셋 등) 전용
  // 배타 실행. 직렬 tail을 점유해 대기 중 stale full-record가 mutation
  // 결과를 되돌리는 순서를 차단하고, 슬롯 안에서 canonical을 재동기화한다.
  // public sync()는 tail을 기다리므로 슬롯 안에서 부르면 자기 교착
  runExclusiveLegacyMutation<T>(mutation: () => Promise<T>): Promise<T> {
    this.assertWritable();
    return this.enqueueSerialized(async () => {
      await this.start();
      await this.drainUntilSettled();
      await this.eventQueue.wait();
      const result = await mutation();
      try {
        await this.fetchAndApplyCanonical('resync');
      } catch (error) {
        // 명령 성공을 재동기화 실패로 뒤집지 않음 - committed 이벤트가 보정
        console.error('배타 legacy mutation 재동기화 실패', error);
      }
      return result;
    });
  }

  // 플러그인 발신 커밋을 gesture 커밋과 같은 단일 직렬 큐에 태운다.
  // 별도 게이트를 두면 gesture 큐와 상호 대기 교착이 생기므로 큐는 하나만 유지
  private enqueueSerialized<T>(task: () => Promise<T>): Promise<T> {
    return this.serializedCommitQueue.enqueue(task);
  }

  // 플러그인 발신 keys 쓰기 전용 격리 커밋 (계약 §10)
  // 공유 snapshot 병합(queueSnapshot/drain)에 합류시키지 않고, 현재 드레인이
  // 끝난 뒤 독점 요청 1건으로 직렬화한다. 자사 커밋 진입점들은
  // waitForGestureCommits로 같은 큐를 기다리므로 multiKey provenance가
  // false → true로 승격되는 병합 경로가 구조적으로 없다
  commitIsolatedPluginPatch(
    changes: EditorPatchV1 | EditorLegacyPatchV1,
    options: { multiKey: boolean },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitIsolatedPluginPatchInner(changes, options),
    );
  }

  private async commitIsolatedPluginPatchInner(
    changes: EditorPatchV1 | EditorLegacyPatchV1,
    options: { multiKey: boolean },
  ): Promise<CanonicalEditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue.wait();
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }

    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges, 'editor patch', 'input');
    const baseDocument = clone(this.requireLastAck());
    const target = applyIsolatedPluginPatch(baseDocument, canonicalChanges);
    const requestFields = EDITOR_FIELDS.filter(
      (field) => canonicalChanges[field] !== undefined,
    );
    if (requestFields.length === 0) return clone(this.requireLastAck());

    const baseRevision = this.requireRevision();
    const mutationId = this.createMutationId();
    const inFlight: InFlightCommit = {
      mutationId,
      baseRevision,
      baseDocument,
      target: clone(baseDocument),
      localFields: getChangedEditorFields(baseDocument, target, 'input'),
      requestFields,
      gestureIds: [],
      isolated: true,
    };
    this.inFlight = inFlight;
    this.rememberOwnMutation(inFlight, true);
    this.phase = 'saving';
    this.notify();

    try {
      const result = await this.transport.commit({
        baseRevision,
        mutationId,
        // 플러그인 격리 커밋은 v1 유지 - ID 없는 레거시 패치를 백엔드
        // adapter가 수용한다 (계약 §10)
        changes: patchForFields(target, requestFields),
        // provenance 명시 전달 - 기본값 승격 경로 없음
        multiKey: options.multiKey === true,
      });
      assertEditorCommitResult(result);
      // v1 adapter가 무ID 요소에 ID를 채우므로 canonical은 요청 target과
      // 다를 수 있고, 결과 envelope에는 adapted 값이 없다. target을 lastAck로
      // 승인하지 않고 canonical을 직접 읽어 성공했을 때만 전진한다 - 읽기가
      // 실패하면 revision을 이전 값에 묶어 두어 own committed 이벤트가
      // 선점 없이 patch를 적용해 자가 복구한다 (no-op이면 canonical이
      // 이전과 같아 복구할 것이 없다)
      const canonical = await this.transport.get();
      assertEditorGetResult(canonical);
      if (canonical.revision >= this.requireRevision()) {
        this.revision = canonical.revision;
        this.lastAck = clone(canonical.document);
      }
      // 실행 창의 로컬 문서도 canonical로 갱신 - 격리 커밋은 낙관 적용을
      // 거치지 않으므로 여기서 반영하지 않으면 이후 flush가 낡은 로컬을
      // 새 편집으로 계산해 방금 성공한 변경을 되돌린다
      this.applyDocument(clone(this.requireLastAck()), 'localPatch');
      this.error = null;
      this.failureKind = null;
      this.phase = 'idle';
      this.notify();
      return clone(this.requireLastAck());
    } catch (error) {
      // 거절돼도 코디네이터는 건강한 상태 유지 - 오류는 플러그인 호출자에게만
      // 전파하고 pending은 보존하지 않음 (conflict resync 성공 시에만 로컬이
      // canonical로 전진)
      if (
        isEditorCommitError(error) &&
        error.errorCode === 'REVISION_CONFLICT'
      ) {
        // 플러그인 호출자는 sync()에 접근할 수 없다. revision이 뒤처져
        // 거절됐다면 canonical만 재동기화해 다음 재시도가 성공하게 한다.
        // patch 자동 재적용은 하지 않는다 - concurrent writer를 덮을 수 있다
        try {
          await this.fetchAndApplyCanonical('resync');
        } catch {
          // 재동기화 실패 시 원래 conflict 오류를 유지
        }
      }
      if (!this.conflict && !this.stopped) this.phase = 'idle';
      this.notify();
      throw error;
    } finally {
      if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
    }
  }

  // 플러그인이 자체 envelope로 직접 editor_commit을 수행할 때도 같은 큐로
  // 직렬화 (계약 §10: coordinator에 예약된 변경보다 먼저 lock을 잡는 경합 차단)
  runSerializedPluginCommit<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueueSerialized(async () => {
      await this.start();
      await this.drainUntilSettled();
      await this.eventQueue.wait();
      return task();
    });
  }

  commitGesture(
    changes: EditorGestureMutation,
    gestureId: string,
    commit: (
      context: EditorGestureCommitContext,
    ) => Promise<EditorCommitResult>,
    meta?: {
      onEnrolled?: () => void;
      prepare?: () => Promise<void>;
      reconcileRetryableEditorIntent?: () => boolean;
    },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitGestureInner(changes, gestureId, commit, meta),
    );
  }

  async retryPending(): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }
    if (!this.pendingLocal && this.pendingRequestFields.length === 0) {
      return clone(this.requireLastAck());
    }

    this.error = null;
    this.failureKind = null;
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async resolveConflict(
    resolution: EditorConflictResolution,
  ): Promise<CanonicalEditorDocumentV1> {
    if (resolution === 'keepLocal') this.assertWritable();
    await this.waitForGestureCommits();
    if (this.drainPromise) {
      await this.drainPromise.catch(() => undefined);
    }

    const conflict = this.conflict;
    if (!conflict) return clone(this.requireLastAck());

    this.conflict = null;
    this.error = null;
    this.failureKind = null;
    this.revision = conflict.canonicalRevision;
    this.lastAck = clone(conflict.canonical);

    if (resolution === 'acceptCanonical') {
      const discardedGestureIds = [...this.pendingGestureIds];
      this.pendingLocal = null;
      this.pendingFields = [];
      this.pendingRequestFields = [];
      this.pendingGestureIds = [];
      if (discardedGestureIds.length > 0) {
        this.onGestureIdsDiscarded?.(discardedGestureIds);
      }
      this.phase = 'idle';
      this.applyDocument(clone(conflict.canonical), 'acceptCanonical');
      this.notify();
      return clone(conflict.canonical);
    }

    const rebased = rebaseEditorDocument(
      conflict.canonical,
      conflict.pendingLocal,
      conflict.localFields,
    );
    this.pendingLocal = rebased;
    this.pendingFields = [...conflict.localFields];
    this.applyDocument(clone(rebased), 'keepLocal');
    this.notify();
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async sync(options: EditorSyncOptions = {}): Promise<void> {
    await this.waitForGestureCommits();
    await this.start();
    if (this.syncPromise) {
      await this.syncPromise;
    } else {
      this.syncPromise = this.fetchAndApplyCanonical('resync').finally(() => {
        this.syncPromise = null;
      });
      await this.syncPromise;
    }

    if (options.reapply) {
      const displayDocument =
        this.getLatestPendingDocument() ?? this.requireLastAck();
      this.applyDocument(clone(displayDocument), 'resync');
      this.notify();
    }
  }

  async flush(): Promise<CanonicalEditorDocumentV1> {
    await this.waitForGestureCommits();
    if (this.isReadOnly()) {
      await this.start();
      await this.eventQueue.wait();
      return clone(this.requireLastAck());
    }
    // 인자 없이 호출해 내부 대기 후 캡처 - 대기 사이 착지한 병행 커밋 보존
    await this.commitEditorState();
    if (this.drainPromise) await this.drainPromise;
    await this.eventQueue.wait();
    return clone(this.requireLastAck());
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribeCommitted?.();
    this.unsubscribeCommitted = null;
    this.detachLifecycle();
    this.phase = 'stopped';
    this.notify();
  }

  private async initialize(): Promise<CanonicalEditorGetResult> {
    this.phase = 'initializing';
    this.error = null;
    this.failureKind = null;
    this.initializing = true;
    this.notify();

    this.unsubscribeCommitted = this.transport.onCommitted((event) => {
      if (this.stopped) return;
      if (this.initializing) {
        this.bufferedEvents.push(clone(event));
        return;
      }
      void this.enqueueEvent(event).catch((error) =>
        this.recordBackgroundError(error),
      );
    });
    await this.unsubscribeCommitted.ready;
    this.attachLifecycle();

    const result = await this.transport.get();
    assertEditorGetResult(result);
    this.revision = result.revision;
    this.lastAck = clone(result.document);
    this.applyDocument(clone(result.document), 'initial');
    this.initializing = false;

    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const event of buffered) {
      await this.processCommittedEventWithRecovery(event);
    }

    if (!this.conflict) this.phase = 'idle';
    this.notify();
    return clone(result);
  }

  private ensureDrain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;

    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (!this.conflict && !this.error && !this.stopped) {
        this.phase = 'idle';
      }
      this.notify();
    });
    return this.drainPromise;
  }

  private async drainUntilSettled(): Promise<void> {
    do {
      await this.ensureDrain();
    } while (
      (this.pendingLocal || this.pendingRequestFields.length > 0) &&
      !this.conflict &&
      !this.stopped
    );
  }

  private async drain(): Promise<void> {
    let rebaseAttempts = 0;

    while (
      (this.pendingLocal || this.pendingRequestFields.length > 0) &&
      !this.conflict &&
      !this.stopped
    ) {
      const target = this.pendingLocal ?? clone(this.requireLastAck());
      const actualChangedFields = getChangedEditorFields(
        this.requireLastAck(),
        target,
      );
      const localFields = this.pendingFields.filter((field) =>
        actualChangedFields.includes(field),
      );
      const requested = new Set<EditorField>([
        ...localFields,
        ...this.pendingRequestFields,
      ]);
      const requestFields = EDITOR_FIELDS.filter((field) =>
        requested.has(field),
      );
      this.pendingLocal = null;
      this.pendingFields = [];
      this.pendingRequestFields = [];

      if (requestFields.length === 0) {
        continue;
      }

      const baseDocument = clone(this.requireLastAck());
      const baseRevision = this.requireRevision();
      const mutationId = this.createMutationId();
      const gestureIds = this.pendingGestureIds;
      this.pendingGestureIds = [];
      const gestureId = gestureIds.at(-1);
      const inFlight: InFlightCommit = {
        mutationId,
        baseRevision,
        baseDocument,
        target: clone(target),
        localFields,
        requestFields,
        gestureIds,
      };
      this.inFlight = inFlight;
      this.rememberOwnMutation(inFlight);
      this.phase = 'saving';
      this.notify();

      try {
        const result = await this.transport.commit({
          baseRevision,
          mutationId,
          // 자사 커밋은 v2 - 백엔드가 ID 필수와 merged 유일성을 검증한다
          changes: patchForFields(
            target,
            requestFields,
            EDITOR_COMMIT_SCHEMA_VERSION,
          ),
          ...(gestureId ? { gestureId } : {}),
          ...(gestureIds.length > 0 ? { gestureIds } : {}),
        });
        assertEditorCommitResult(result);
        await this.applyCommitResult(inFlight, result);
        rebaseAttempts = 0;
      } catch (error) {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;

        if (
          isEditorCommitError(error) &&
          error.errorCode === 'REVISION_CONFLICT'
        ) {
          this.restorePendingGestureIds(inFlight.gestureIds);
          let didRebase: boolean;
          try {
            didRebase = await this.handleRevisionConflict(
              inFlight,
              error,
              rebaseAttempts,
            );
          } catch (syncError) {
            this.preservePending(
              inFlight.target,
              inFlight.localFields,
              inFlight.requestFields,
            );
            this.phase = 'error';
            this.error = syncError;
            this.failureKind = 'transient';
            this.notify();
            throw syncError;
          }
          if (didRebase) {
            rebaseAttempts += 1;
            continue;
          }
        } else if (
          isEditorCommitError(error) &&
          isRetryableEditorCommitError(error)
        ) {
          this.preservePending(
            inFlight.target,
            inFlight.localFields,
            inFlight.requestFields,
          );
          this.restorePendingGestureIds(inFlight.gestureIds);
          this.phase = 'error';
          this.error = error;
          this.failureKind = 'transient';
          this.notify();
        } else {
          this.discardRejectedPending(error, mutationId, inFlight.gestureIds);
        }
        throw error;
      } finally {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
      }
    }
  }

  private async commitGestureInner(
    changes: EditorGestureMutation,
    gestureId: string,
    commit: (
      context: EditorGestureCommitContext,
    ) => Promise<EditorCommitResult>,
    meta?: {
      onEnrolled?: () => void;
      prepare?: () => Promise<void>;
      reconcileRetryableEditorIntent?: () => boolean;
    },
  ): Promise<CanonicalEditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue.wait();
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }
    if (meta?.prepare) {
      // 슬롯 안 준비 단계(plugin 큐 drain·projection 봉인 등) - 대기 중
      // 들어온 이벤트를 반영한 뒤 base를 동결해야 projection과 정렬된다
      await meta.prepare();
      await this.eventQueue.wait();
      if (this.conflict) {
        throw this.error ?? new Error('editor conflict pending');
      }
    }

    const baseDocument = clone(this.requireLastAck());
    // generator는 직렬 슬롯 안에서 최신 base로 평가한다 - 호출 시점 캡처
    // full-record는 대기 중 정산된 다른 커밋의 컬렉션 값을 되돌린다.
    // null 반환은 editorChanges 없음일 뿐 transaction callback은 실행된다
    // (plugin 변경만 커밋하는 혼합 게스처)
    const resolvedMutation =
      typeof changes === 'function' ? changes(clone(baseDocument)) : changes;
    let ops: EditorOpV1[] | undefined;
    let resolvedChanges: EditorPatchV1 | null | undefined;
    if (isGestureOpsMutation(resolvedMutation)) {
      ops = clone([...resolvedMutation.ops]);
      assertEditorOpsV1(ops);
    } else {
      resolvedChanges = resolvedMutation;
    }
    const canonicalChanges = resolvedChanges
      ? canonicalizeEditorGradients(resolvedChanges)
      : undefined;
    if (canonicalChanges) assertEditorPatch(canonicalChanges);
    const target = ops
      ? applySemanticOps(baseDocument, ops)
      : canonicalChanges
      ? applyEditorPatch(baseDocument, canonicalChanges)
      : baseDocument;
    assertCanonicalEditorDocument(target, 'gesture target document');
    const requestFields = ops
      ? [...new Set(ops.flatMap(fieldsForSemanticOp))]
      : canonicalChanges
      ? EDITOR_FIELDS.filter((field) => canonicalChanges[field] !== undefined)
      : [];
    const localFields = getChangedEditorFields(baseDocument, target);
    // 슬롯 내 로컬 낙관 재적용 - wire만 고치면 백엔드는 맞고 UI 스토어는
    // 옛 값에 남는 경우가 있어 CAS 통과분만 되쓴다
    if (ops) {
      this.reapplyFrozenIntent(baseDocument, { ops });
    } else if (canonicalChanges) {
      this.reapplyFrozenIntent(baseDocument, { changes: canonicalChanges });
    }
    const mutationId = this.createMutationId();
    const inFlight: InFlightCommit = {
      mutationId,
      baseRevision: this.requireRevision(),
      baseDocument,
      target: clone(target),
      localFields,
      requestFields,
      gestureIds: [gestureId],
      semanticOps: ops !== undefined,
    };
    this.inFlight = inFlight;
    this.rememberOwnMutation(inFlight);
    this.phase = 'saving';
    this.notify();
    try {
      // 편입 관측점 - 이후 실패는 gesture 실패 경로(pending·conflict)가
      // 소유한다. no-throw 계약이지만 방어적으로 격리
      meta?.onEnrolled?.();
    } catch (error) {
      console.error('onEnrolled callback failed', error);
    }

    try {
      const result = await commit({
        editorBaseRevision: inFlight.baseRevision,
        mutationId,
        // 게스처 커밋도 자사 전용 경로라 v2
        ...(ops
          ? { editorOpsVersion: EDITOR_OPS_VERSION, editorOps: ops }
          : requestFields.length > 0
          ? {
              editorChanges: patchForFields(
                target,
                requestFields,
                EDITOR_COMMIT_SCHEMA_VERSION,
              ),
            }
          : {}),
      });
      if (ops) {
        assertEditorOpCommitResult(result, ops);
        assertSemanticChangedFields(
          inFlight.baseDocument,
          ops,
          result.opResults!,
          result,
        );
        await this.applySemanticGestureCommitResult(ops, result);
        this.logSemanticCommit(result, result.opResults!, 0);
      } else {
        assertEditorCommitResult(result);
        await this.applyCommitResult(inFlight, result);
      }
      this.error = null;
      this.failureKind = null;
      this.phase = 'idle';
      this.notify();
      return clone(this.requireLastAck());
    } catch (error) {
      this.ownMutations.delete(mutationId);
      const retryable =
        isEditorCommitError(error) && isRetryableEditorCommitError(error);
      const reconcileEditorIntent =
        retryable && meta?.reconcileRetryableEditorIntent?.() === true;
      if (reconcileEditorIntent) {
        this.restorePendingGestureIds(inFlight.gestureIds);
        let didRebase: boolean;
        try {
          didRebase = await this.handleRevisionConflict(inFlight, error, 0);
        } catch (syncError) {
          this.preservePending(
            inFlight.target,
            inFlight.localFields,
            inFlight.requestFields,
          );
          this.phase = 'error';
          this.error = syncError;
          this.failureKind = 'transient';
          this.notify();
          throw syncError;
        }
        if (!didRebase) throw error;

        await this.drainUntilSettled();
        this.error = null;
        this.failureKind = null;
        this.phase = 'idle';
        this.notify();
        return clone(this.requireLastAck());
      }
      if (retryable) {
        try {
          const canonical = await this.transport.get();
          assertEditorGetResult(canonical);
          if (canonical.revision >= this.requireRevision()) {
            this.revision = canonical.revision;
            this.lastAck = clone(canonical.document);
          }
        } catch {
          // 원래 transaction 오류를 유지
        }
      }
      if (!retryable && inFlight.gestureIds.length > 0) {
        this.onGestureIdsDiscarded?.(inFlight.gestureIds);
      }
      this.applyRejectedGestureProjection(inFlight);
      this.error = error;
      this.failureKind = retryable ? 'transient' : 'permanent';
      this.phase = 'error';
      this.notify();
      throw error;
    } finally {
      if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
    }
  }

  private applyRejectedGestureProjection(inFlight: InFlightCommit): void {
    const local = this.readDocument();
    const changedAfterTarget = new Set(
      getChangedEditorFields(inFlight.target, local),
    );
    const changedAfterBase = new Set(
      getChangedEditorFields(inFlight.baseDocument, local),
    );
    const rollbackFields = inFlight.localFields.filter(
      (field) => !changedAfterTarget.has(field) || !changedAfterBase.has(field),
    );
    if (rollbackFields.length === 0) return;

    // 실패한 transaction 이후의 낙관 편집은 rollback 소유 범위 밖
    const rejected = applyEditorPatch(
      local,
      patchForFields(this.requireLastAck(), rollbackFields),
    );
    this.applyDocument(clone(rejected), 'rejected');
  }

  private async waitForGestureCommits(): Promise<void> {
    await this.serializedCommitQueue.wait();
  }

  private async applyCommitResult(
    inFlight: InFlightCommit,
    result: EditorCommitResult,
  ): Promise<void> {
    const currentRevision = this.requireRevision();
    if (result.revision > currentRevision + 1) {
      await this.fetchAndApplyCanonical('resync');
      return;
    }

    if (result.revision >= currentRevision) {
      this.revision = result.revision;
      if (
        result.revision > currentRevision ||
        result.changedFields.length === 0
      ) {
        this.lastAck = clone(inFlight.target);
      }
    }
    this.error = null;
    this.failureKind = null;
  }

  private async applySemanticGestureCommitResult(
    ops: readonly EditorOpV1[],
    result: EditorCommitResult,
  ): Promise<void> {
    const opResults = result.opResults!;
    const currentRevision = this.requireRevision();
    if (
      opResults.some(({ status }) => status === 'targetMissing') ||
      result.revision > currentRevision + 1
    ) {
      await this.syncSemanticCanonical();
      return;
    }
    if (result.revision >= currentRevision) {
      this.revision = result.revision;
      this.lastAck = applySemanticOps(this.requireLastAck(), ops, opResults);
    }
    this.error = null;
    this.failureKind = null;
  }

  private async handleRevisionConflict(
    inFlight: InFlightCommit,
    error: EditorCommitError,
    rebaseAttempts: number,
  ): Promise<boolean> {
    const requested = new Set<EditorField>([
      ...this.pendingRequestFields,
      ...inFlight.requestFields,
    ]);
    this.pendingRequestFields = EDITOR_FIELDS.filter((field) =>
      requested.has(field),
    );

    if (this.conflict) {
      this.error = error;
      this.failureKind = null;
      this.phase = 'conflict';
      this.notify();
      return false;
    }

    const result = await this.transport.get();
    assertEditorGetResult(result);

    const pending = this.pendingLocal ?? inFlight.target;
    const localFields =
      this.pendingLocal !== null
        ? [...this.pendingFields]
        : inFlight.localFields;
    const { remainingLocalFields, overlappingFields, rebased } =
      planEditorRebase(
        result.document,
        pending,
        localFields,
        getChangedEditorFields(inFlight.baseDocument, result.document),
      );

    this.revision = result.revision;
    this.lastAck = clone(result.document);
    this.applyDocument(clone(rebased), 'rebase');

    if (
      overlappingFields.length > 0 ||
      (remainingLocalFields.length > 0 &&
        hasReachedEditorAutoRebaseLimit(rebaseAttempts))
    ) {
      this.pendingLocal = null;
      this.pendingFields = [];
      this.conflict = {
        lastAck: clone(inFlight.baseDocument),
        pendingLocal: clone(pending),
        canonical: clone(result.document),
        canonicalRevision: result.revision,
        localFields: [...remainingLocalFields],
        overlappingFields,
        reason: overlappingFields.length > 0 ? 'overlap' : 'rebaseLimit',
      };
      this.error = error;
      this.failureKind = null;
      this.phase = 'conflict';
      this.notify();
      return false;
    }

    this.pendingLocal = remainingLocalFields.length > 0 ? rebased : null;
    this.pendingFields = [...remainingLocalFields];
    this.error = null;
    this.failureKind = null;
    this.notify();
    return true;
  }

  private enqueueEvent(event: EditorCommittedV1): Promise<void> {
    return this.eventQueue.enqueue(() =>
      this.processCommittedEventWithRecovery(event),
    );
  }

  private async processCommittedEventWithRecovery(
    event: EditorCommittedV1,
  ): Promise<void> {
    let previewSettled = false;
    const settlePreview = () => {
      if (previewSettled) return;
      previewSettled = true;
      this.onCommittedApplied?.(event);
    };
    try {
      await this.processCommittedEvent(event, settlePreview);
    } catch (error) {
      if (!(error instanceof EditorProtocolError)) throw error;
      this.ownMutations.delete(event.mutationId);
      this.isolatedMutations.delete(event.mutationId);
      try {
        await this.fetchAndApplyCanonical('resync');
      } finally {
        // 잘못된 이벤트도 프리뷰 세션 정리를 막지 않는다
        settlePreview();
      }
    }
  }

  private async processCommittedEvent(
    event: EditorCommittedV1,
    settlePreview: () => void = () => this.onCommittedApplied?.(event),
  ): Promise<void> {
    assertEditorCommittedEvent(event);
    if (this.stopped || this.revision === null || !this.lastAck) return;

    if (event.revision <= this.revision) {
      this.ownMutations.delete(event.mutationId);
      this.isolatedMutations.delete(event.mutationId);
      settlePreview();
      return;
    }
    if (event.revision > this.revision + 1) {
      try {
        await this.fetchAndApplyCanonical('resync');
      } finally {
        // 프리뷰 정리는 canonical 재동기화 성공 여부와 독립
        settlePreview();
      }
      return;
    }

    const previousCanonical = this.lastAck;
    const canonical = applyEditorPatch(previousCanonical, event.patch);
    assertCanonicalEditorDocument(
      canonical,
      'editor:committed canonical document',
    );
    const isOwnMutation = this.ownMutations.has(event.mutationId);
    if (isOwnMutation) this.ownMutations.delete(event.mutationId);
    this.revision = event.revision;
    this.lastAck = clone(canonical);

    if (isOwnMutation) {
      this.error = null;
      // 격리 커밋은 낙관 적용이 없다. 커밋 경로의 canonical 재동기화가
      // 실패했을 때만 이 분기까지 오므로 store에도 적용해야 다음 flush가
      // 성공한 플러그인 변경을 낡은 로컬로 되돌리지 않는다
      if (this.isolatedMutations.delete(event.mutationId)) {
        this.applyExternalCanonical(
          canonical,
          event.changedFields,
          event.revision,
          'event',
          previousCanonical,
        );
      } else {
        this.notify();
      }
      settlePreview();
      return;
    }

    this.applyExternalCanonical(
      canonical,
      event.changedFields,
      event.revision,
      'event',
      previousCanonical,
    );
    settlePreview();
  }

  private async fetchAndApplyCanonical(
    reason: Extract<EditorApplyReason, 'resync'>,
  ): Promise<void> {
    const result = await this.transport.get();
    assertEditorGetResult(result);

    if (this.revision !== null && result.revision < this.revision) return;
    if (this.revision === result.revision && this.lastAck) return;

    const previous = this.lastAck;
    this.revision = result.revision;
    this.lastAck = clone(result.document);

    if (!previous) {
      this.applyDocument(clone(result.document), reason);
      this.notify();
      return;
    }

    const remoteFields = getChangedEditorFields(previous, result.document);
    this.applyExternalCanonical(
      result.document,
      remoteFields,
      result.revision,
      reason,
      previous,
    );
  }

  private applyExternalCanonical(
    canonical: CanonicalEditorDocumentV1,
    changedFields: readonly EditorField[],
    canonicalRevision: number,
    reason: Extract<EditorApplyReason, 'event' | 'resync'>,
    previousCanonical?: CanonicalEditorDocumentV1,
  ): void {
    const comparisonBase = this.conflict?.lastAck ?? previousCanonical;
    const pending = this.getLatestPendingDocument();

    if (!pending || !comparisonBase) {
      this.applyDocument(clone(canonical), reason);
      this.error = null;
      this.failureKind = null;
      this.notify();
      return;
    }

    const localFields = this.getLatestPendingFields(comparisonBase, pending);
    const { remainingLocalFields, overlappingFields, rebased } =
      planEditorRebase(
        canonical,
        pending,
        localFields,
        this.conflict
          ? getChangedEditorFields(comparisonBase, canonical)
          : changedFields,
      );

    this.applyDocument(clone(rebased), 'rebase');
    if (
      overlappingFields.length > 0 ||
      (this.conflict?.reason === 'rebaseLimit' &&
        remainingLocalFields.length > 0)
    ) {
      this.pendingLocal = null;
      this.pendingFields = [];
      this.conflict = {
        lastAck: clone(comparisonBase),
        pendingLocal: clone(pending),
        canonical: clone(canonical),
        canonicalRevision,
        localFields: [...remainingLocalFields],
        overlappingFields,
        reason:
          overlappingFields.length > 0
            ? 'overlap'
            : this.conflict?.reason ?? 'rebaseLimit',
      };
      this.phase = 'conflict';
    } else {
      this.conflict = null;
      this.pendingLocal = remainingLocalFields.length > 0 ? rebased : null;
      this.pendingFields = [...remainingLocalFields];
    }
    this.notify();
  }

  // 격리 커밋은 낙관 편집이 아니고 semantic op는 자체 재시도 의도를 가진다.
  // 둘의 full-record target을 일반 pending으로 세면 외부 이벤트와 겹칠 때
  // 이미 별도로 재시도할 op가 conflict 문서로도 한 번 더 남는다
  private optimisticInFlight(): InFlightCommit | null {
    if (!this.inFlight || this.inFlight.isolated || this.inFlight.semanticOps) {
      return null;
    }
    return this.inFlight;
  }

  private getLatestCommitBase(): CanonicalEditorDocumentV1 {
    if (this.conflict) return clone(this.conflict.pendingLocal);
    if (this.pendingLocal) return clone(this.pendingLocal);
    const optimistic = this.optimisticInFlight();
    if (optimistic) return clone(optimistic.target);
    return clone(this.requireLastAck());
  }

  private getLatestPendingDocument(): CanonicalEditorDocumentV1 | null {
    return (
      this.conflict?.pendingLocal ??
      this.pendingLocal ??
      this.optimisticInFlight()?.target ??
      null
    );
  }

  private getLatestPendingFields(
    comparisonBase: CanonicalEditorDocumentV1,
    pending: CanonicalEditorDocumentV1,
  ): EditorField[] {
    if (this.conflict) return [...this.conflict.localFields];
    if (this.pendingLocal) return [...this.pendingFields];
    const optimistic = this.optimisticInFlight();
    if (optimistic) return [...optimistic.localFields];
    return getChangedEditorFields(comparisonBase, pending);
  }

  private preservePending(
    document: CanonicalEditorDocumentV1,
    localFields: readonly EditorField[],
    requestFields: readonly EditorField[] = [],
  ): void {
    if (!this.pendingLocal) {
      this.pendingLocal = clone(document);
      this.pendingFields = [...localFields];
    }
    const requested = new Set<EditorField>([
      ...this.pendingRequestFields,
      ...requestFields,
    ]);
    this.pendingRequestFields = EDITOR_FIELDS.filter((field) =>
      requested.has(field),
    );
  }

  private restorePendingGestureIds(gestureIds: readonly string[]): void {
    this.replacePendingGestureIds([...gestureIds, ...this.pendingGestureIds]);
  }

  private replacePendingGestureIds(gestureIds: readonly string[]): void {
    const { retained, discarded } = retainPendingGestureIds(gestureIds);
    this.pendingGestureIds = retained;
    if (discarded.length > 0) this.onGestureIdsDiscarded?.(discarded);
  }

  private discardRejectedPending(
    error: unknown,
    mutationId: string,
    rejectedGestureIds: readonly string[] = [],
  ): void {
    this.ownMutations.delete(mutationId);
    const discardedGestureIds = [
      ...new Set([...rejectedGestureIds, ...this.pendingGestureIds]),
    ];
    this.pendingLocal = null;
    this.pendingFields = [];
    this.pendingRequestFields = [];
    this.pendingGestureIds = [];
    if (discardedGestureIds.length > 0) {
      this.onGestureIdsDiscarded?.(discardedGestureIds);
    }
    this.phase = 'error';
    this.error = error;
    this.failureKind = 'permanent';
    this.applyDocument(clone(this.requireLastAck()), 'rejected');
    this.notify();
  }

  private rememberOwnMutation(
    inFlight: InFlightCommit,
    isolated = false,
  ): void {
    this.ownMutations.add(inFlight.mutationId);
    if (isolated) this.isolatedMutations.add(inFlight.mutationId);
    while (this.ownMutations.size > MAX_TRACKED_MUTATIONS) {
      const oldest = this.ownMutations.values().next().value;
      if (oldest === undefined) break;
      this.ownMutations.delete(oldest);
      this.isolatedMutations.delete(oldest);
    }
  }

  private attachLifecycle(): void {
    this.focusTarget?.addEventListener('focus', this.handleFocus);
    this.visibilityTarget?.addEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
  }

  private detachLifecycle(): void {
    this.focusTarget?.removeEventListener('focus', this.handleFocus);
    this.visibilityTarget?.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
  }

  private recordBackgroundError(error: unknown): void {
    this.error = error;
    this.failureKind = null;
    if (!this.inFlight && !this.conflict) this.phase = 'error';
    this.notify();
  }

  private requireRevision(): number {
    if (this.revision === null) {
      throw new Error('editor coordinator has not initialized a revision');
    }
    return this.revision;
  }

  private requireLastAck(): CanonicalEditorDocumentV1 {
    if (!this.lastAck) {
      throw new Error('editor coordinator has not initialized a document');
    }
    return this.lastAck;
  }

  private assertWritable(): void {
    if (this.isReadOnly()) throw new EditorReadOnlyError();
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('[Editor] Coordinator state listener failed', error);
      }
    });
  }
}

export const createEditorCoordinator = (
  options: EditorCoordinatorOptions,
): EditorSaveCoordinator => new EditorSaveCoordinator(options);
