import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EDITOR_COMMIT_ERROR_RETRY_POLICY,
  isRetryableEditorCommitError,
} from '../src/types/editor';

import type { EditorCommitError } from '../src/types/editor';

// Rust 테스트(src-tauri/src/errors.rs)와 같은 fixture를 공유해 오류 코드
// 전수와 코드별 재시도 분류가 양 언어에서 기계적으로 일치함을 고정한다
const FIXTURE_PATH = join(__dirname, 'fixtures', 'editor-error-retry.json');

const fixture = (): Record<string, boolean> =>
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, boolean>;

const commitError = (
  errorCode: keyof typeof EDITOR_COMMIT_ERROR_RETRY_POLICY,
): EditorCommitError => ({
  errorCode,
  message: 'sample',
  retryable: false,
});

describe('editor error retry parity', () => {
  it('재시도 정책 테이블 키는 백엔드 오류 코드 전수와 일치한다', () => {
    expect(Object.keys(EDITOR_COMMIT_ERROR_RETRY_POLICY).sort()).toEqual(
      Object.keys(fixture()).sort(),
    );
  });

  it('코드별 재시도 분류는 백엔드 retryable 상수와 일치한다', () => {
    for (const [code, retryable] of Object.entries(fixture())) {
      const policy =
        EDITOR_COMMIT_ERROR_RETRY_POLICY[
          code as keyof typeof EDITOR_COMMIT_ERROR_RETRY_POLICY
        ];
      // rebase는 base 재동기화 후 재시도하는 재시도군
      expect(policy !== 'permanent', code).toBe(retryable);
    }
  });

  it('REVISION_CONFLICT만 rebase로 분류된다', () => {
    const rebaseCodes = Object.entries(EDITOR_COMMIT_ERROR_RETRY_POLICY)
      .filter(([, policy]) => policy === 'rebase')
      .map(([code]) => code);
    expect(rebaseCodes).toEqual(['REVISION_CONFLICT']);
  });

  it('재시도 판단은 wire retryable 플래그가 아니라 테이블을 따른다', () => {
    // wire retryable을 거짓으로 조작해도 코드 분류가 이긴다
    expect(isRetryableEditorCommitError(commitError('IO_ERROR'))).toBe(true);
    expect(isRetryableEditorCommitError(commitError('REVISION_CONFLICT'))).toBe(
      true,
    );
    expect(isRetryableEditorCommitError(commitError('VALIDATION_FAILED'))).toBe(
      false,
    );
  });
});
