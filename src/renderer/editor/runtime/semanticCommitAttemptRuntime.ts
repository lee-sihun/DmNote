import {
  isSemanticCommitFailureRetryable,
  shouldAutoRebaseSemanticConflict,
  shouldRetryUnknownSemanticOutcome,
} from './editorRetryPolicy';
import { clone, getChangedEditorFields } from './editorRebaseModel';
import { applySemanticOps, fieldsForSemanticOp } from './semanticOpsProjection';
import {
  EDITOR_OPS_VERSION,
  EditorProtocolError,
  assertCanonicalEditorDocument,
  assertEditorOpCommitResult,
  assertEditorOpsV1,
  isEditorCommitError,
} from '@src/types/editor';

import type {
  CanonicalEditorDocumentV1,
  CanonicalEditorGetResult,
  EditorCommitRequest,
  EditorCommitResult,
  EditorField,
  EditorOpResultV1,
  EditorOpV1,
} from '@src/types/editor';

export interface EditorSemanticCommitOutcome {
  document: CanonicalEditorDocumentV1;
  opResults: EditorOpResultV1[];
}

export interface EditorSemanticCommitMeta {
  gestureId?: string;
  onEnrolled?: () => void;
  preflight?: () => void;
}

export type EditorSemanticOpsGenerator = (
  base: CanonicalEditorDocumentV1,
) => readonly EditorOpV1[] | null;

export interface SemanticCommitAttemptInFlight {
  mutationId: string;
  baseRevision: number;
  baseDocument: CanonicalEditorDocumentV1;
  target: CanonicalEditorDocumentV1;
  localFields: EditorField[];
  requestFields: EditorField[];
  gestureIds: string[];
  semanticOps: true;
}

type SemanticCommitAttemptPhase = 'idle' | 'saving' | 'error';
type SemanticCommitAttemptFailureKind = 'transient' | 'permanent' | null;

interface SemanticCommitAttemptStatePatch {
  inFlight?: SemanticCommitAttemptInFlight | null;
  revision?: number;
  lastAck?: CanonicalEditorDocumentV1;
  error?: unknown;
  failureKind?: SemanticCommitAttemptFailureKind;
  phase?: SemanticCommitAttemptPhase;
}

export interface SemanticCommitAttemptDependencies {
  start(): Promise<unknown>;
  drainUntilSettled(): Promise<void>;
  waitForEvents(): Promise<void>;
  readConflict(): { active: boolean; error: unknown };
  readLastAck(): CanonicalEditorDocumentV1;
  readRevision(): number;
  readInFlightMutationId(): string | null;
  createMutationId(): string;
  setState(patch: SemanticCommitAttemptStatePatch): void;
  notify(): void;
  applyDocument(document: CanonicalEditorDocumentV1, reason: 'rejected'): void;
  reapplyFrozenIntent(
    base: CanonicalEditorDocumentV1,
    ops: readonly EditorOpV1[],
  ): void;
  rememberOwnMutation(inFlight: SemanticCommitAttemptInFlight): void;
  forgetOwnMutation(mutationId: string): void;
  discardGestureIds(gestureIds: readonly string[]): void;
  commit(request: EditorCommitRequest): Promise<EditorCommitResult>;
  syncCanonical(): Promise<CanonicalEditorGetResult>;
  assertChangedFields(
    base: CanonicalEditorDocumentV1,
    ops: readonly EditorOpV1[],
    opResults: readonly EditorOpResultV1[],
    result: EditorCommitResult,
  ): void;
  logCommit(
    result: EditorCommitResult,
    opResults: readonly EditorOpResultV1[],
    retryCount: number,
  ): void;
}

interface SemanticCommitRuntimeState {
  baseDocument: CanonicalEditorDocumentV1;
  baseRevision: number;
  mutationId: string;
  conflictRetryCount: number;
  totalRetryCount: number;
  enrolled: boolean;
}

interface PreparedSemanticCommitAttempt {
  ops: EditorOpV1[];
  request: EditorCommitRequest;
  inFlight: SemanticCommitAttemptInFlight;
}

const rejectEnrolledAttempt = (
  dependencies: SemanticCommitAttemptDependencies,
  gestureId: string | undefined,
): void => {
  dependencies.applyDocument(clone(dependencies.readLastAck()), 'rejected');
  if (gestureId) {
    dependencies.discardGestureIds([gestureId]);
  }
  dependencies.setState({ error: null });
  dependencies.setState({ failureKind: null });
  dependencies.setState({ phase: 'idle' });
  dependencies.notify();
};

const prepareSemanticCommitAttempt = (
  generate: EditorSemanticOpsGenerator,
  meta: EditorSemanticCommitMeta,
  runtime: SemanticCommitRuntimeState,
  dependencies: SemanticCommitAttemptDependencies,
): PreparedSemanticCommitAttempt | null => {
  let ops: EditorOpV1[];
  try {
    meta.preflight?.();
    const generated = generate(clone(runtime.baseDocument));
    if (!generated) {
      if (runtime.enrolled) {
        rejectEnrolledAttempt(dependencies, meta.gestureId);
      }
      return null;
    }
    assertEditorOpsV1(generated);
    ops = clone([...generated]);
  } catch (error) {
    if (runtime.enrolled) {
      rejectEnrolledAttempt(dependencies, meta.gestureId);
    }
    throw error;
  }

  const request: EditorCommitRequest = {
    baseRevision: runtime.baseRevision,
    mutationId: runtime.mutationId,
    opsVersion: EDITOR_OPS_VERSION,
    ops,
    ...(meta.gestureId ? { gestureId: meta.gestureId } : {}),
  };
  const target = applySemanticOps(runtime.baseDocument, ops);
  assertCanonicalEditorDocument(target, 'semantic target document');
  dependencies.reapplyFrozenIntent(runtime.baseDocument, ops);
  const requestFields = [...new Set(ops.flatMap(fieldsForSemanticOp))];
  const inFlight: SemanticCommitAttemptInFlight = {
    mutationId: runtime.mutationId,
    baseRevision: runtime.baseRevision,
    baseDocument: clone(runtime.baseDocument),
    target,
    localFields: getChangedEditorFields(runtime.baseDocument, target),
    requestFields,
    gestureIds: meta.gestureId ? [meta.gestureId] : [],
    semanticOps: true,
  };
  dependencies.setState({ inFlight });
  dependencies.rememberOwnMutation(inFlight);
  dependencies.setState({ phase: 'saving' });
  dependencies.setState({ error: null });
  dependencies.setState({ failureKind: null });
  dependencies.notify();
  if (!runtime.enrolled) {
    runtime.enrolled = true;
    try {
      meta.onEnrolled?.();
    } catch (error) {
      console.error('onEnrolled callback failed', error);
    }
  }
  return { ops, request, inFlight };
};

export const runSemanticCommitAttemptRuntime = async (
  generate: EditorSemanticOpsGenerator,
  meta: EditorSemanticCommitMeta,
  dependencies: SemanticCommitAttemptDependencies,
): Promise<EditorSemanticCommitOutcome | null> => {
  // 직렬 슬롯 준비
  await dependencies.start();
  await dependencies.drainUntilSettled();
  await dependencies.waitForEvents();
  const conflict = dependencies.readConflict();
  if (conflict.active) {
    throw conflict.error ?? new Error('editor conflict pending');
  }

  const runtime: SemanticCommitRuntimeState = {
    baseDocument: clone(dependencies.readLastAck()),
    baseRevision: dependencies.readRevision(),
    mutationId: dependencies.createMutationId(),
    conflictRetryCount: 0,
    totalRetryCount: 0,
    enrolled: false,
  };

  while (true) {
    // 최신 canonical 기반 attempt 준비
    const attempt = prepareSemanticCommitAttempt(
      generate,
      meta,
      runtime,
      dependencies,
    );
    if (!attempt) return null;

    let outcomeUnknownRetryCount = 0;
    try {
      let result: EditorCommitResult;
      let opResults: EditorOpResultV1[];
      // 결과 미상 동일 mutation 재전송
      while (true) {
        try {
          result = await dependencies.commit(attempt.request);
          assertEditorOpCommitResult(result, attempt.ops);
          opResults = clone(result.opResults!);
          dependencies.assertChangedFields(
            runtime.baseDocument,
            attempt.ops,
            opResults,
            result,
          );
          break;
        } catch (error) {
          if (
            !shouldRetryUnknownSemanticOutcome(error, outcomeUnknownRetryCount)
          ) {
            throw error;
          }
          outcomeUnknownRetryCount += 1;
          runtime.totalRetryCount += 1;
        }
      }

      // 성공 assertion 이후 canonical 정산
      const hasMissing = opResults.some(
        (opResult) => opResult.status === 'targetMissing',
      );
      const currentRevision = dependencies.readRevision();
      if (hasMissing || result.revision > currentRevision + 1) {
        await dependencies.syncCanonical();
      } else if (result.revision >= currentRevision) {
        const acknowledged = applySemanticOps(
          dependencies.readLastAck(),
          attempt.ops,
          opResults,
        );
        dependencies.setState({ revision: result.revision });
        dependencies.setState({ lastAck: clone(acknowledged) });
      }
      dependencies.setState({ error: null });
      dependencies.setState({ failureKind: null });
      dependencies.setState({ phase: 'idle' });
      dependencies.notify();
      dependencies.logCommit(result, opResults, runtime.totalRetryCount);
      return {
        document: clone(dependencies.readLastAck()),
        opResults,
      };
    } catch (error) {
      // retryable failure canonical 조정·자동 rebase
      if (dependencies.readInFlightMutationId() === runtime.mutationId) {
        dependencies.setState({ inFlight: null });
      }

      if (shouldAutoRebaseSemanticConflict(error, runtime.conflictRetryCount)) {
        dependencies.forgetOwnMutation(runtime.mutationId);
        try {
          const canonical = await dependencies.syncCanonical();
          runtime.baseDocument = canonical.document;
          runtime.baseRevision = canonical.revision;
          runtime.mutationId = dependencies.createMutationId();
          runtime.conflictRetryCount += 1;
          runtime.totalRetryCount += 1;
          continue;
        } catch (syncError) {
          dependencies.applyDocument(
            clone(dependencies.readLastAck()),
            'rejected',
          );
          if (attempt.inFlight.gestureIds.length > 0) {
            dependencies.discardGestureIds(attempt.inFlight.gestureIds);
          }
          dependencies.setState({ error: syncError });
          dependencies.setState({ failureKind: 'transient' });
          dependencies.setState({ phase: 'error' });
          dependencies.notify();
          throw syncError;
        }
      }

      if (!isEditorCommitError(error) || error.errorCode !== 'IO_ERROR') {
        dependencies.forgetOwnMutation(runtime.mutationId);
      }
      let canonical: CanonicalEditorGetResult | null = null;
      try {
        canonical = await dependencies.syncCanonical();
      } catch {
        // 원래 커밋 오류 유지
        if (!(error instanceof EditorProtocolError)) {
          dependencies.applyDocument(
            clone(dependencies.readLastAck()),
            'rejected',
          );
        }
      }
      const protocolOutcomeReflected =
        error instanceof EditorProtocolError &&
        canonical !== null &&
        getChangedEditorFields(
          canonical.document,
          applySemanticOps(canonical.document, attempt.ops),
        ).length === 0;
      if (protocolOutcomeReflected) {
        if (attempt.inFlight.gestureIds.length > 0) {
          dependencies.discardGestureIds(attempt.inFlight.gestureIds);
        }
        dependencies.setState({ error: null });
        dependencies.setState({ failureKind: null });
        dependencies.setState({ phase: 'idle' });
        dependencies.notify();
        throw error;
      }
      const retryable = isSemanticCommitFailureRetryable(error);
      if (
        !(error instanceof EditorProtocolError) &&
        attempt.inFlight.gestureIds.length > 0
      ) {
        dependencies.discardGestureIds(attempt.inFlight.gestureIds);
      }
      dependencies.setState({ error });
      dependencies.setState({
        failureKind: retryable ? 'transient' : 'permanent',
      });
      dependencies.setState({ phase: 'error' });
      dependencies.notify();
      throw error;
    } finally {
      if (dependencies.readInFlightMutationId() === runtime.mutationId) {
        dependencies.setState({ inFlight: null });
      }
    }
  }
};
