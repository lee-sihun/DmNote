import { describe, expect, it } from 'vitest';
import { EditorProtocolError, type EditorCommitError } from '@src/types/editor';
import {
  hasReachedEditorAutoRebaseLimit,
  isSemanticCommitFailureRetryable,
  shouldAutoRebaseSemanticConflict,
  shouldRetryUnknownSemanticOutcome,
} from './editorRetryPolicy';

const commitError = (
  errorCode: EditorCommitError['errorCode'],
): EditorCommitError => ({ errorCode, message: errorCode, retryable: false });

describe('editorRetryPolicy', () => {
  it('결과 불명 오류와 IO_ERROR만 같은 mutation으로 한 번 재전송한다', () => {
    expect(shouldRetryUnknownSemanticOutcome(new Error('network'), 0)).toBe(
      true,
    );
    expect(shouldRetryUnknownSemanticOutcome(commitError('IO_ERROR'), 0)).toBe(
      true,
    );
    expect(shouldRetryUnknownSemanticOutcome(commitError('IO_ERROR'), 1)).toBe(
      false,
    );
    expect(
      shouldRetryUnknownSemanticOutcome(commitError('VALIDATION_FAILED'), 0),
    ).toBe(false);
  });

  it('revision conflict 자동 rebase를 두 번으로 제한한다', () => {
    const conflict = commitError('REVISION_CONFLICT');
    expect(shouldAutoRebaseSemanticConflict(conflict, 0)).toBe(true);
    expect(shouldAutoRebaseSemanticConflict(conflict, 1)).toBe(true);
    expect(shouldAutoRebaseSemanticConflict(conflict, 2)).toBe(false);
    expect(hasReachedEditorAutoRebaseLimit(2)).toBe(true);
    expect(shouldAutoRebaseSemanticConflict(commitError('IO_ERROR'), 0)).toBe(
      false,
    );
  });

  it('protocol·transport·정책상 transient 오류를 재시도 가능으로 분류한다', () => {
    expect(
      isSemanticCommitFailureRetryable(new EditorProtocolError('invalid')),
    ).toBe(true);
    expect(isSemanticCommitFailureRetryable(new Error('transport'))).toBe(true);
    expect(
      isSemanticCommitFailureRetryable(commitError('HISTORY_IN_PROGRESS')),
    ).toBe(true);
    expect(
      isSemanticCommitFailureRetryable(commitError('VALIDATION_FAILED')),
    ).toBe(false);
  });
});
