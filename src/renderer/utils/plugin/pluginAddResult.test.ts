import { describe, expect, it } from 'vitest';

import { classifyPluginAddResult } from './pluginAddResult';

describe('플러그인 추가 결과 분류', () => {
  it('저장된 플러그인에 실행 오류가 있어도 추가 실패로 표시하지 않는다', () => {
    expect(classifyPluginAddResult(1, 1)).toBe('partial');
  });

  it('저장된 파일 없이 오류만 있으면 추가 실패로 표시한다', () => {
    expect(classifyPluginAddResult(0, 1)).toBe('failed');
  });

  it('오류 없는 추가와 사용자 취소를 구분한다', () => {
    expect(classifyPluginAddResult(2, 0)).toBe('success');
    expect(classifyPluginAddResult(0, 0)).toBe('none');
  });
});
