import { describe, expect, it } from 'vitest';

import { SIDE_PANEL_FRAME_CLASS } from '../Grid/PropertiesPanel/panelChrome';
import { CANVAS_POPUP_MATERIAL_CLASS } from './popupChrome';

describe('canvas popup material', () => {
  it('side panel과 같은 tint와 canvas clamp를 사용한다', () => {
    expect(CANVAS_POPUP_MATERIAL_CLASS).toContain('bg-glass-panel');
    expect(CANVAS_POPUP_MATERIAL_CLASS).toContain('backdrop-glass-popup');
    expect(CANVAS_POPUP_MATERIAL_CLASS).toContain('backdrop-glass-canvas');
    expect(CANVAS_POPUP_MATERIAL_CLASS).not.toContain('bg-glass ');
    expect(CANVAS_POPUP_MATERIAL_CLASS).not.toContain('bg-glass-heavy');
    for (const className of CANVAS_POPUP_MATERIAL_CLASS.split(' ')) {
      expect(SIDE_PANEL_FRAME_CLASS.split(' ')).toContain(className);
    }
  });
});
