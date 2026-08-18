import { describe, expect, it } from 'vitest';

import { PANEL_HEADER_CLASS, PANEL_HEADER_HEIGHT } from './panelChrome';

describe('panelChrome', () => {
  // 클래스는 Tailwind 추출을 위해 리터럴, 높이는 창 드래그 판정용 숫자.
  // 한쪽만 바꾸면 헤더 높이와 드래그 영역이 어긋난다
  it('헤더 클래스와 헤더 높이 상수가 같은 값을 가리킨다', () => {
    expect(PANEL_HEADER_CLASS).toContain(`h-[${PANEL_HEADER_HEIGHT}px]`);
  });
});
