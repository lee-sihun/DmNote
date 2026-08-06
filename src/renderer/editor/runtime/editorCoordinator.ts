import { stableStringify } from '@utils/core/stableStringify';

import {
  EDITOR_FIELDS,
  EDITOR_SCHEMA_VERSION,
  assertEditorCommitResult,
  assertEditorCommittedEvent,
  assertEditorDocument,
  assertEditorGetResult,
  assertEditorPatch,
  canonicalizeEditorGradients,
  isEditorCommitError,
} from '@src/types/editor';

import type {
  EditorCommitError,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorDocumentV1,
  EditorField,
  EditorGetResult,
  EditorGestureCommitContext,
  EditorPatchV1,
} from '@src/types/editor';

export type EditorApplyReason =
  | 'initial'
  | 'localPatch'
  | 'event'
  | 'resync'
  | 'rebase'
  | 'rejected'
  | 'keepLocal'
  | 'acceptCanonical';

export type EditorConflictReason = 'overlap' | 'rebaseLimit';
export type EditorConflictResolution = 'keepLocal' | 'acceptCanonical';

export interface EditorConflictState {
  lastAck: EditorDocumentV1;
  pendingLocal: EditorDocumentV1;
  canonical: EditorDocumentV1;
  canonicalRevision: number;
  localFields: EditorField[];
  overlappingFields: EditorField[];
  reason: EditorConflictReason;
}

export type EditorCoordinatorPhase =
  | 'idle'
  | 'initializing'
  | 'saving'
  | 'conflict'
  | 'error'
  | 'stopped';

export interface EditorCoordinatorState {
  phase: EditorCoordinatorPhase;
  revision: number | null;
  dirty: boolean;
  inFlightMutationId: string | null;
  lastAck: EditorDocumentV1 | null;
  pendingLocal: EditorDocumentV1 | null;
  conflict: EditorConflictState | null;
  error: unknown;
  failureKind: 'transient' | 'permanent' | null;
}

export type EditorReadyUnsubscribe = (() => void) & { ready: Promise<void> };

export interface EditorCoordinatorTransport {
  get(): Promise<EditorGetResult>;
  commit(request: EditorCommitRequest): Promise<EditorCommitResult>;
  onCommitted(
    listener: (event: EditorCommittedV1) => void,
  ): EditorReadyUnsubscribe;
}

interface EditorEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface EditorVisibilityTarget extends EditorEventTarget {
  visibilityState?: string;
}

export interface EditorCoordinatorOptions {
  transport: EditorCoordinatorTransport;
  readDocument(): EditorDocumentV1;
  applyDocument(document: EditorDocumentV1, reason: EditorApplyReason): void;
  createMutationId?: () => string;
  focusTarget?: EditorEventTarget | null;
  visibilityTarget?: EditorVisibilityTarget | null;
  readOnly?: boolean | (() => boolean);
  // committed 이벤트가 canonical에 반영된 직후 호출 (프리뷰 오버레이 정리용)
  onCommittedApplied?: (event: EditorCommittedV1) => void;
  onGestureIdsDiscarded?: (gestureIds: readonly string[]) => void;
  onStartSucceeded?: () => void | Promise<void>;
}

export interface EditorSyncOptions {
  reapply?: boolean;
}

export class EditorReadOnlyError extends Error {
  constructor() {
    super('editor coordinator is read-only');
    this.name = 'EditorReadOnlyError';
  }
}

interface InFlightCommit {
  mutationId: string;
  baseRevision: number;
  baseDocument: EditorDocumentV1;
  target: EditorDocumentV1;
  localFields: EditorField[];
  requestFields: EditorField[];
  gestureIds: string[];
}

const MAX_AUTO_REBASE_ATTEMPTS = 2;
const MAX_TRACKED_MUTATIONS = 64;
// Rust state/editor.rs의 MAX_GESTURE_IDS와 동일한 IPC 상한
const MAX_PENDING_GESTURE_IDS = 32;

const clone = <T>(value: T): T => structuredClone(value);

const fieldsOverlap = (
  first: readonly EditorField[],
  second: readonly EditorField[],
): EditorField[] => {
  const secondSet = new Set(second);
  return first.filter((field) => secondSet.has(field));
};

const unresolvedLocalFields = (
  localFields: readonly EditorField[],
  pendingLocal: EditorDocumentV1,
  canonical: EditorDocumentV1,
): EditorField[] =>
  localFields.filter(
    (field) =>
      stableStringify(pendingLocal[field]) !==
      stableStringify(canonical[field]),
  );

const patchForFields = (
  document: EditorDocumentV1,
  fields: readonly EditorField[],
): EditorPatchV1 => {
  const patch: EditorPatchV1 = { schemaVersion: EDITOR_SCHEMA_VERSION };
  fields.forEach((field) => {
    Object.assign(patch, { [field]: clone(document[field]) });
  });
  return patch;
};

export function getChangedEditorFields(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorField[] {
  assertEditorDocument(base, 'base editor document');
  assertEditorDocument(next, 'next editor document');

  return EDITOR_FIELDS.filter(
    (field) => stableStringify(base[field]) !== stableStringify(next[field]),
  );
}

export function createEditorPatch(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorPatchV1 {
  return patchForFields(next, getChangedEditorFields(base, next));
}

export function applyEditorPatch(
  base: EditorDocumentV1,
  patch: EditorPatchV1,
): EditorDocumentV1 {
  assertEditorDocument(base, 'base editor document');
  assertEditorPatch(patch);

  const next = clone(base);
  EDITOR_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      Object.assign(next, { [field]: clone(patch[field]) });
    }
  });
  assertEditorDocument(next, 'patched editor document');
  return next;
}

export function rebaseEditorDocument(
  canonical: EditorDocumentV1,
  pendingLocal: EditorDocumentV1,
  localFields: readonly EditorField[],
): EditorDocumentV1 {
  return applyEditorPatch(canonical, patchForFields(pendingLocal, localFields));
}

export class EditorSaveCoordinator {
  private readonly transport: EditorCoordinatorTransport;
  private readonly readDocument: () => EditorDocumentV1;
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
  private lastAck: EditorDocumentV1 | null = null;
  private pendingLocal: EditorDocumentV1 | null = null;
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

  private startPromise: Promise<EditorGetResult> | null = null;
  private drainPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private eventQueue: Promise<void> = Promise.resolve();
  private gestureCommitTail: Promise<unknown> = Promise.resolve();
  private unsubscribeCommitted: EditorReadyUnsubscribe | null = null;
  private bufferedEvents: EditorCommittedV1[] = [];
  private ownMutations = new Set<string>();
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

  start(): Promise<EditorGetResult> {
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
    document?: EditorDocumentV1,
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    // gradient canonical 정규화를 assert 앞에 — 이후 diff·invoke가 같은 값 사용
    const currentDocument = canonicalizeEditorGradients(
      document ?? this.readDocument(),
    );
    assertEditorDocument(currentDocument);
    const snapshot = clone(currentDocument);

    const projected = this.getLatestCommitBase();
    const newIntentFields = getChangedEditorFields(projected, snapshot);
    return this.queueSnapshot(snapshot, newIntentFields, []);
  }

  private async queueSnapshot(
    snapshot: EditorDocumentV1,
    newIntentFields: readonly EditorField[],
    requestFields: readonly EditorField[],
    gestureId?: string,
  ): Promise<EditorDocumentV1> {
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
      this.notify();
      return Promise.reject(this.error ?? new Error('editor conflict pending'));
    }

    const outstandingFields = new Set<EditorField>([
      ...(this.inFlight?.localFields ?? []),
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
    this.error = null;
    this.failureKind = null;
    this.notify();
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async commitPatch(
    changes: EditorPatchV1,
    meta?: { gestureId?: string },
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    // gradient canonical 정규화를 assert 앞에 — optimistic·diff·invoke가 같은 값 사용
    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges);

    const projected = this.getLatestCommitBase();
    const target = applyEditorPatch(projected, canonicalChanges);
    const newIntentFields = getChangedEditorFields(projected, target);
    const requestFields = EDITOR_FIELDS.filter(
      (field) => canonicalChanges[field] !== undefined,
    );
    const currentDocument = this.readDocument();
    assertEditorDocument(currentDocument);
    const optimisticDocument = applyEditorPatch(
      currentDocument,
      canonicalChanges,
    );
    if (
      getChangedEditorFields(currentDocument, optimisticDocument).length > 0
    ) {
      this.applyDocument(clone(optimisticDocument), 'localPatch');
    }
    return this.queueSnapshot(
      target,
      newIntentFields,
      requestFields,
      meta?.gestureId,
    );
  }

  // 플러그인 발신 커밋을 gesture 커밋과 같은 단일 직렬 큐에 태운다.
  // 별도 게이트를 두면 gesture 큐와 상호 대기 교착이 생기므로 큐는 하나만 유지
  private enqueueSerialized<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.gestureCommitTail;
    // 앞선 작업 실패가 다음 작업으로 전파되지 않게 양쪽 경로 모두 실행
    const run = previous.then(task, task);
    this.gestureCommitTail = run;
    return run;
  }

  // 플러그인 발신 keys 쓰기 전용 격리 커밋 (계약 §10)
  // 공유 snapshot 병합(queueSnapshot/drain)에 합류시키지 않고, 현재 드레인이
  // 끝난 뒤 독점 요청 1건으로 직렬화한다. 자사 커밋 진입점들은
  // waitForGestureCommits로 같은 큐를 기다리므로 multiKey provenance가
  // false → true로 승격되는 병합 경로가 구조적으로 없다
  commitIsolatedPluginPatch(
    changes: EditorPatchV1,
    options: { multiKey: boolean },
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitIsolatedPluginPatchInner(changes, options),
    );
  }

  private async commitIsolatedPluginPatchInner(
    changes: EditorPatchV1,
    options: { multiKey: boolean },
  ): Promise<EditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue;
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }

    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges);
    const baseDocument = clone(this.requireLastAck());
    const target = applyEditorPatch(baseDocument, canonicalChanges);
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
      target: clone(target),
      localFields: getChangedEditorFields(baseDocument, target),
      requestFields,
      gestureIds: [],
    };
    this.inFlight = inFlight;
    this.rememberOwnMutation(inFlight);
    this.phase = 'saving';
    this.notify();

    try {
      const result = await this.transport.commit({
        baseRevision,
        mutationId,
        changes: patchForFields(target, requestFields),
        // provenance 명시 전달 - 기본값 승격 경로 없음
        multiKey: options.multiKey === true,
      });
      assertEditorCommitResult(result);
      await this.applyCommitResult(inFlight, result);
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
      // 전파하고 pending은 보존하지 않음 (store·로컬 모두 불변)
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
      await this.eventQueue;
      return task();
    });
  }

  commitGesture(
    changes: EditorPatchV1 | undefined,
    gestureId: string,
    commit: (
      context: EditorGestureCommitContext,
    ) => Promise<EditorCommitResult>,
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    const previous = this.gestureCommitTail;
    // 앞선 gesture 실패가 다음 gesture로 전파되지 않게 양쪽 경로 모두 실행
    const runInner = () => this.commitGestureInner(changes, gestureId, commit);
    const run = previous.then(runInner, runInner);
    this.gestureCommitTail = run;
    void run.then(
      () => {
        if (this.gestureCommitTail === run) {
          this.gestureCommitTail = Promise.resolve();
        }
      },
      () => {
        if (this.gestureCommitTail === run) {
          this.gestureCommitTail = Promise.resolve();
        }
      },
    );
    return run;
  }

  async retryPending(): Promise<EditorDocumentV1> {
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
  ): Promise<EditorDocumentV1> {
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
      this.pendingLocal = null;
      this.pendingFields = [];
      this.pendingRequestFields = [];
      this.pendingGestureIds = [];
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

  async flush(): Promise<EditorDocumentV1> {
    await this.waitForGestureCommits();
    if (this.isReadOnly()) {
      await this.start();
      await this.eventQueue;
      return clone(this.requireLastAck());
    }
    await this.commitEditorState(this.readDocument());
    if (this.drainPromise) await this.drainPromise;
    await this.eventQueue;
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

  private async initialize(): Promise<EditorGetResult> {
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
      await this.processCommittedEvent(event);
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
          changes: patchForFields(target, requestFields),
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
            this.restorePendingGestureIds(inFlight.gestureIds);
            this.phase = 'error';
            this.error = syncError;
            this.failureKind = 'transient';
            this.notify();
            throw syncError;
          }
          if (didRebase) {
            rebaseAttempts += 1;
            this.restorePendingGestureIds(inFlight.gestureIds);
            continue;
          }
        } else if (isEditorCommitError(error) && error.retryable) {
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
          this.discardRejectedPending(error, mutationId);
        }
        throw error;
      } finally {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
      }
    }
  }

  private async commitGestureInner(
    changes: EditorPatchV1 | undefined,
    gestureId: string,
    commit: (
      context: EditorGestureCommitContext,
    ) => Promise<EditorCommitResult>,
  ): Promise<EditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue;
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }

    const canonicalChanges = changes
      ? canonicalizeEditorGradients(changes)
      : undefined;
    if (canonicalChanges) assertEditorPatch(canonicalChanges);
    const baseDocument = clone(this.requireLastAck());
    const target = canonicalChanges
      ? applyEditorPatch(baseDocument, canonicalChanges)
      : baseDocument;
    const requestFields = canonicalChanges
      ? EDITOR_FIELDS.filter((field) => canonicalChanges[field] !== undefined)
      : [];
    const localFields = getChangedEditorFields(baseDocument, target);
    const mutationId = this.createMutationId();
    const inFlight: InFlightCommit = {
      mutationId,
      baseRevision: this.requireRevision(),
      baseDocument,
      target: clone(target),
      localFields,
      requestFields,
      gestureIds: [gestureId],
    };
    this.inFlight = inFlight;
    this.rememberOwnMutation(inFlight);
    this.phase = 'saving';
    this.notify();

    try {
      const result = await commit({
        editorBaseRevision: inFlight.baseRevision,
        mutationId,
        ...(requestFields.length > 0
          ? { editorChanges: patchForFields(target, requestFields) }
          : {}),
      });
      assertEditorCommitResult(result);
      await this.applyCommitResult(inFlight, result);
      this.error = null;
      this.failureKind = null;
      this.phase = 'idle';
      this.notify();
      return clone(this.requireLastAck());
    } catch (error) {
      this.ownMutations.delete(mutationId);
      if (isEditorCommitError(error) && error.retryable) {
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
      this.error = error;
      this.failureKind =
        isEditorCommitError(error) && error.retryable
          ? 'transient'
          : 'permanent';
      this.phase = 'error';
      this.applyRejectedGestureProjection(inFlight);
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
    await this.gestureCommitTail.catch(() => undefined);
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
    const remainingLocalFields = unresolvedLocalFields(
      localFields,
      pending,
      result.document,
    );
    const remoteFields = getChangedEditorFields(
      inFlight.baseDocument,
      result.document,
    );
    const overlappingFields = fieldsOverlap(remainingLocalFields, remoteFields);
    const rebased = rebaseEditorDocument(
      result.document,
      pending,
      remainingLocalFields,
    );

    this.revision = result.revision;
    this.lastAck = clone(result.document);
    this.applyDocument(clone(rebased), 'rebase');

    if (
      overlappingFields.length > 0 ||
      (remainingLocalFields.length > 0 &&
        rebaseAttempts >= MAX_AUTO_REBASE_ATTEMPTS)
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
    const queued = this.eventQueue.then(() =>
      this.processCommittedEvent(event),
    );
    this.eventQueue = queued.catch(() => undefined);
    return queued;
  }

  private async processCommittedEvent(event: EditorCommittedV1): Promise<void> {
    assertEditorCommittedEvent(event);
    if (this.stopped || this.revision === null || !this.lastAck) return;

    if (event.revision <= this.revision) {
      this.ownMutations.delete(event.mutationId);
      this.onCommittedApplied?.(event);
      return;
    }
    if (event.revision > this.revision + 1) {
      try {
        await this.fetchAndApplyCanonical('resync');
      } finally {
        // 프리뷰 정리는 canonical 재동기화 성공 여부와 독립
        this.onCommittedApplied?.(event);
      }
      return;
    }

    const previousCanonical = this.lastAck;
    const canonical = applyEditorPatch(previousCanonical, event.patch);
    const isOwnMutation = this.ownMutations.has(event.mutationId);
    if (isOwnMutation) this.ownMutations.delete(event.mutationId);
    this.revision = event.revision;
    this.lastAck = clone(canonical);

    if (isOwnMutation) {
      this.error = null;
      this.notify();
      this.onCommittedApplied?.(event);
      return;
    }

    this.applyExternalCanonical(
      canonical,
      event.changedFields,
      event.revision,
      'event',
      previousCanonical,
    );
    this.onCommittedApplied?.(event);
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
    canonical: EditorDocumentV1,
    changedFields: readonly EditorField[],
    canonicalRevision: number,
    reason: Extract<EditorApplyReason, 'event' | 'resync'>,
    previousCanonical?: EditorDocumentV1,
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
    const remainingLocalFields = unresolvedLocalFields(
      localFields,
      pending,
      canonical,
    );
    const remoteFields = this.conflict
      ? getChangedEditorFields(comparisonBase, canonical)
      : [...changedFields];
    const overlappingFields = fieldsOverlap(remainingLocalFields, remoteFields);
    const rebased = rebaseEditorDocument(
      canonical,
      pending,
      remainingLocalFields,
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

  private getLatestCommitBase(): EditorDocumentV1 {
    if (this.conflict) return clone(this.conflict.pendingLocal);
    if (this.pendingLocal) return clone(this.pendingLocal);
    if (this.inFlight) return clone(this.inFlight.target);
    return clone(this.requireLastAck());
  }

  private getLatestPendingDocument(): EditorDocumentV1 | null {
    return (
      this.conflict?.pendingLocal ??
      this.pendingLocal ??
      this.inFlight?.target ??
      null
    );
  }

  private getLatestPendingFields(
    comparisonBase: EditorDocumentV1,
    pending: EditorDocumentV1,
  ): EditorField[] {
    if (this.conflict) return [...this.conflict.localFields];
    if (this.pendingLocal) return [...this.pendingFields];
    if (this.inFlight) return [...this.inFlight.localFields];
    return getChangedEditorFields(comparisonBase, pending);
  }

  private preservePending(
    document: EditorDocumentV1,
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
    const seen = new Set<string>();
    const retainedNewestFirst: string[] = [];
    const discardedNewestFirst: string[] = [];

    for (let index = gestureIds.length - 1; index >= 0; index -= 1) {
      const gestureId = gestureIds[index];
      if (seen.has(gestureId)) continue;
      seen.add(gestureId);
      if (retainedNewestFirst.length < MAX_PENDING_GESTURE_IDS) {
        retainedNewestFirst.push(gestureId);
      } else {
        discardedNewestFirst.push(gestureId);
      }
    }

    this.pendingGestureIds = retainedNewestFirst.reverse();
    if (discardedNewestFirst.length > 0) {
      this.onGestureIdsDiscarded?.(discardedNewestFirst.reverse());
    }
  }

  private discardRejectedPending(error: unknown, mutationId: string): void {
    this.ownMutations.delete(mutationId);
    this.pendingLocal = null;
    this.pendingFields = [];
    this.pendingRequestFields = [];
    this.pendingGestureIds = [];
    this.phase = 'error';
    this.error = error;
    this.failureKind = 'permanent';
    this.applyDocument(clone(this.requireLastAck()), 'rejected');
    this.notify();
  }

  private rememberOwnMutation(inFlight: InFlightCommit): void {
    this.ownMutations.add(inFlight.mutationId);
    while (this.ownMutations.size > MAX_TRACKED_MUTATIONS) {
      const oldest = this.ownMutations.values().next().value;
      if (oldest === undefined) break;
      this.ownMutations.delete(oldest);
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

  private requireLastAck(): EditorDocumentV1 {
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
