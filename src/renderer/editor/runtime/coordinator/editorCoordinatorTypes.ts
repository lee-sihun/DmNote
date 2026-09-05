import type {
  CanonicalEditorDocumentV1,
  EditorField,
  EditorOpV1,
  EditorPatchV1,
  EditorGetResult,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EDITOR_OPS_VERSION,
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
  lastAck: CanonicalEditorDocumentV1;
  pendingLocal: CanonicalEditorDocumentV1;
  canonical: CanonicalEditorDocumentV1;
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
  lastAck: CanonicalEditorDocumentV1 | null;
  pendingLocal: CanonicalEditorDocumentV1 | null;
  conflict: EditorConflictState | null;
  error: unknown;
  failureKind: 'transient' | 'permanent' | null;
}

export type EditorReadyUnsubscribe = (() => void) & { ready: Promise<void> };

// 직렬 슬롯 안에서 최신 base로 patch를 재생성하는 게스처 커밋 입력.
// null = editorChanges 없음 (plugin transaction은 실행)
export type EditorPatchGenerator = (
  base: CanonicalEditorDocumentV1,
) => EditorPatchV1 | null;

export interface EditorGestureOpsMutation {
  opsVersion: typeof EDITOR_OPS_VERSION;
  ops: readonly EditorOpV1[];
}

export type EditorGestureMutationGenerator = (
  base: CanonicalEditorDocumentV1,
) => EditorPatchV1 | EditorGestureOpsMutation | null;

export type EditorGestureMutation =
  | EditorPatchV1
  | EditorGestureMutationGenerator
  | EditorGestureOpsMutation
  | undefined;

export interface EditorCoordinatorTransport {
  get(): Promise<EditorGetResult>;
  commit(request: EditorCommitRequest): Promise<EditorCommitResult>;
  onCommitted(
    listener: (event: EditorCommittedV1) => void,
  ): EditorReadyUnsubscribe;
}

export interface EditorEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface EditorVisibilityTarget extends EditorEventTarget {
  visibilityState?: string;
}

export interface EditorCoordinatorOptions {
  transport: EditorCoordinatorTransport;
  readDocument(): CanonicalEditorDocumentV1;
  applyDocument(
    document: CanonicalEditorDocumentV1,
    reason: EditorApplyReason,
  ): void;
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

export interface InFlightCommit {
  mutationId: string;
  baseRevision: number;
  baseDocument: CanonicalEditorDocumentV1;
  target: CanonicalEditorDocumentV1;
  localFields: EditorField[];
  requestFields: EditorField[];
  gestureIds: string[];
  // 낙관 적용 없이 전송되는 격리 플러그인 커밋. 승인 전 target을
  // 로컬 pending이나 커밋 base로 세면 안 된다
  isolated?: boolean;
  semanticOps?: boolean;
}
