import { describe, expect, it } from 'vitest';

import {
  PANEL_HEADER_CLASS,
  PANEL_HEADER_HEIGHT,
  SIDE_PANEL_CHIP_MATERIAL_CLASS,
  SIDE_PANEL_FRAME_CLASS,
} from './panelChrome';

describe('panelChrome', () => {
  // 클래스는 Tailwind 추출을 위해 리터럴, 높이는 창 드래그 판정용 숫자.
  // 한쪽만 바꾸면 헤더 높이와 드래그 영역이 어긋난다
  it('헤더 클래스와 헤더 높이 상수가 같은 값을 가리킨다', () => {
    expect(PANEL_HEADER_CLASS).toContain(`h-[${PANEL_HEADER_HEIGHT}px]`);
  });

  it('도킹 패널은 대면적 glass 재질을 유지한다', () => {
    expect(SIDE_PANEL_FRAME_CLASS).toContain('bg-glass-panel');
    expect(SIDE_PANEL_FRAME_CLASS).toContain('backdrop-glass-popup');
    expect(SIDE_PANEL_FRAME_CLASS).toContain('backdrop-glass-canvas');
    expect(SIDE_PANEL_FRAME_CLASS).not.toContain('solid');
  });

  // 칩은 opacity로 등퇴장한다 - 라이브 블러가 붙으면 WKWebView에서 점멸
  it('접힘 토글 칩은 라이브 블러 없는 솔리드 재질이다', () => {
    expect(SIDE_PANEL_CHIP_MATERIAL_CLASS).toContain('bg-glass-panel-solid');
    expect(SIDE_PANEL_CHIP_MATERIAL_CLASS).not.toContain('backdrop-glass');
  });
});
