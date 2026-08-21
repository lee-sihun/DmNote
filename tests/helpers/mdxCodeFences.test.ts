import { describe, expect, it } from 'vitest';

import { extractMdxCodeFences } from './mdxCodeFences';

describe('extractMdxCodeFences', () => {
  it('CRLF 문서의 메타데이터 코드 펜스를 추출한다', () => {
    const content = [
      '```javascript fragment=object-members',
      'messages: {',
      '  ko: { greeting: "안녕하세요" },',
      '},',
      '```',
      '',
    ].join('\r\n');

    expect(extractMdxCodeFences(content)).toEqual([
      {
        lang: 'javascript',
        fragment: 'object-members',
        code: ['messages: {', '  ko: { greeting: "안녕하세요" },', '},'].join(
          '\n',
        ),
        startLine: 1,
      },
    ]);
  });
});
