import {
  EditorProtocolError,
  isEditorCommitError,
  isRetryableEditorCommitError,
} from '@src/types/editor';

const MAX_SEMANTIC_AUTO_REBASE_ATTEMPTS = 2;
const MAX_UNKNOWN_OUTCOME_RETRIES = 1;

export const hasReachedEditorAutoRebaseLimit = (
  rebaseAttempts: number,
): boolean => rebaseAttempts >= MAX_SEMANTIC_AUTO_REBASE_ATTEMPTS;

export const shouldRetryUnknownSemanticOutcome = (
  error: unknown,
  retryCount: number,
): boolean => {
  const outcomeUnknown =
    !isEditorCommitError(error) || error.errorCode === 'IO_ERROR';
  return outcomeUnknown && retryCount < MAX_UNKNOWN_OUTCOME_RETRIES;
};

export const shouldAutoRebaseSemanticConflict = (
  error: unknown,
  rebaseAttempts: number,
): boolean =>
  isEditorCommitError(error) &&
  error.errorCode === 'REVISION_CONFLICT' &&
  !hasReachedEditorAutoRebaseLimit(rebaseAttempts);

export const isSemanticCommitFailureRetryable = (error: unknown): boolean =>
  error instanceof EditorProtocolError ||
  !isEditorCommitError(error) ||
  isRetryableEditorCommitError(error);
