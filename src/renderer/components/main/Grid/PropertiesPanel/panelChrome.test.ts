import { describe, expect, it } from 'vitest';

import { MINIMAP_SURFACE_CLASS } from '@components/main/Grid/core/minimapChrome';
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
    expect(SIDE_PANEL_CHIP_MATERIAL_CLASS).toContain('-solid');
    expect(SIDE_PANEL_CHIP_MATERIAL_CLASS).not.toContain('backdrop-glass');
  });

  // 칩이 보이는 건 패널이 닫혀 있을 때뿐이고, 그때는 미니맵과 같은 티어의
  // 캔버스 부유 칩이다. 패널 계열 재질로 되돌리면 라이트에서 두 칩이 8 L* 벌어진다
  it('접힘 토글 칩은 미니맵과 같은 캔버스 크롬 계열을 쓴다', () => {
    expect(SIDE_PANEL_CHIP_MATERIAL_CLASS).toContain('bg-glass-dim');
    expect(MINIMAP_SURFACE_CLASS).toContain('bg-glass-dim');
  });
});
