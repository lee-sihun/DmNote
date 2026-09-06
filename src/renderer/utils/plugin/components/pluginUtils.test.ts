import { describe, expect, it } from 'vitest';

import { extractPluginId, getPluginDisplayName } from './pluginUtils';

describe('pluginUtils 식별자·표시명', () => {
  it('@id 메타데이터가 있으면 그 값을 소문자로 쓴다', () => {
    expect(extractPluginId('// @id: My-Plugin\nvoid 0;', 'anything.js')).toBe(
      'my-plugin',
    );
  });

  it('파일명 폴백은 확장자를 벗기고 기호를 하이픈으로 접는다', () => {
    expect(extractPluginId('void 0;', 'My Plugin (v2).js')).toBe(
      'my-plugin-v2',
    );
  });

  // 기호만 있는 파일명은 정규화 결과가 비어 컨텍스트 부재로 읽힌다 - 고정 폴백
  it('정규화 결과가 비면 고정 id로 폴백한다', () => {
    expect(extractPluginId('void 0;', '...js')).toBe('plugin');
  });

  it('표시명은 id와 같은 확장자 집합을 벗긴다', () => {
    expect(getPluginDisplayName('counter.js')).toBe('counter');
    expect(getPluginDisplayName('counter.mjs')).toBe('counter');
    expect(getPluginDisplayName('counter.ts')).toBe('counter');
    expect(getPluginDisplayName('.js')).toBe('.js');
  });
});
