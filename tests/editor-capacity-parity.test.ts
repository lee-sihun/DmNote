import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EDITOR_CAPACITY_VALIDATION_CODES,
  isEditorCapacityFailure,
} from '../src/types/editor';

import type { EditorCommitError } from '../src/types/editor';

// Rust 테스트(src-tauri/src/errors.rs)와 같은 fixture를 공유해, 용량 초과로
// 분류되는 validationCode 전수가 양 언어에서 기계적으로 일치함을 고정한다.
// 목록에서 빠진 코드는 "저장 한도 초과" 대신 일반 오류 안내로 새어 나간다
const FIXTURE_PATH = join(__dirname, 'fixtures', 'editor-capacity-codes.json');

const fixture = (): string[] =>
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as string[];

const capacityError = (validationCode: string): EditorCommitError => ({
  errorCode: 'VALIDATION_FAILED',
  message: 'sample',
  retryable: false,
  details: { validationCode },
});

describe('editor capacity validation code parity', () => {
  it('용량 코드 집합은 백엔드 전수와 일치한다', () => {
    expect([...EDITOR_CAPACITY_VALIDATION_CODES].sort()).toEqual(
      fixture().sort(),
    );
  });

  it('용량 코드는 전부 용량 실패로 분류된다', () => {
    for (const code of fixture()) {
      expect(isEditorCapacityFailure(capacityError(code))).toBe(true);
    }
  });

  it('용량 코드가 아닌 validationCode는 용량 실패가 아니다', () => {
    expect(isEditorCapacityFailure(capacityError('MISSING_ELEMENT_ID'))).toBe(
      false,
    );
    expect(isEditorCapacityFailure(capacityError('GROUP_NAME_TOO_LONG'))).toBe(
      false,
    );
  });

  it('retryable 오류는 용량 실패로 오분류되지 않는다', () => {
    expect(
      isEditorCapacityFailure({
        errorCode: 'IO_ERROR',
        message: 'sample',
        retryable: true,
      }),
    ).toBe(false);
  });
});
