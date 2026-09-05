import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPanelAnchoredPopupPosition } from '@hooks/ui/usePanelAnchoredPopupPosition';

describe('사이드 패널 팝업 앵커 정렬', () => {
  it('팝업을 트리거 행 세로 중앙에 맞추고 X는 패널 왼쪽에 도킹한다', () => {
    expect(
      getPanelAnchoredPopupPosition({
        panelRect: { left: 800, top: 100, width: 180, height: 600 },
        anchorCenterY: 240,
        popupWidth: 200,
        popupHeight: 100,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
      // 팝업 중심(190+50) == 앵커 중심(240)
    ).toEqual({ x: 595, y: 190 });
  });

  it('앵커가 없으면 패널 세로 중앙으로 폴백한다', () => {
    expect(
      getPanelAnchoredPopupPosition({
        panelRect: { left: 800, top: 100, width: 180, height: 600 },
        anchorCenterY: null,
        popupWidth: 200,
        popupHeight: 100,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 595, y: 350 });
  });

  it('앵커가 위쪽이면 팝업 상단을 패널 상단에 맞춰 멈춘다', () => {
    expect(
      getPanelAnchoredPopupPosition({
        panelRect: { left: 800, top: 100, width: 180, height: 600 },
        anchorCenterY: 120,
        popupWidth: 200,
        popupHeight: 200,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
      // 앵커 중심 120 기준이면 20이지만 패널 top(100)+갭(5)에서 멈춤
    ).toEqual({ x: 595, y: 105 });
  });

  it('앵커가 아래쪽이면 팝업 하단을 패널 하단에 맞춰 멈춘다', () => {
    expect(
      getPanelAnchoredPopupPosition({
        panelRect: { left: 800, top: 100, width: 180, height: 400 },
        anchorCenterY: 450,
        popupWidth: 200,
        popupHeight: 200,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
      // 앵커 중심 450 기준이면 350이지만 패널 bottom(500)-갭(5)에서 멈춤
    ).toEqual({ x: 595, y: 295 });
  });

  it('화면 경계에서는 팝업 전체가 보이도록 클램프한다', () => {
    // 앵커가 화면 위로 벗어난 경우
    expect(
      getPanelAnchoredPopupPosition({
        panelRect: { left: 100, top: -50, width: 180, height: 100 },
        anchorCenterY: -30,
        popupWidth: 200,
        popupHeight: 200,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 5, y: 5 });

    // 앵커가 화면 하단 근처라 팝업이 잘리는 경우
    expect(
      getPanelAnchoredPopupPosition({
        panelRect: { left: 1200, top: 700, width: 180, height: 200 },
        anchorCenterY: 780,
        popupWidth: 200,
        popupHeight: 300,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 795, y: 495 });
  });

  it('패널 외부 피커 3종이 공용 표시 호스트를 거쳐 같은 앵커 정렬을 쓴다', () => {
    const files = ['color/ColorPicker.tsx', 'ImagePicker.tsx', 'ShadowPicker.tsx'];

    for (const file of files) {
      const source = readFileSync(
        resolve(
          process.cwd(),
          'src/renderer/components/main/Modal/content/pickers',
          file,
        ),
        'utf8',
      );
      // 좌표 계산을 각자 들고 있으면 팝업·페이지 표현이 갈라진다
      expect(source).toContain('PickerSurface');
      expect(source).not.toContain('usePanelAnchoredPopupPosition');
      expect(source).not.toContain('FloatingPopup');
    }

    const surface = readFileSync(
      resolve(
        process.cwd(),
        'src/renderer/components/main/Grid/PropertiesPanel/controls/PickerSurface.tsx',
      ),
      'utf8',
    );
    expect(surface).toContain('usePanelAnchoredPopupPosition');
    expect(surface).toContain('referenceRef,');
    expect(surface).not.toContain('panelRect.bottom');
  });
});
