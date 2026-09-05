import { describe, expect, it } from 'vitest';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  buildPluginElementStyle,
  buildPluginOverlayHitStyle,
  calculatePluginAnchorOffset,
  resolvePluginElementPosition,
} from './pluginElementLayout';

const element = {
  id: 'instance',
  fullId: 'plugin::instance',
  pluginId: 'plugin',
  html: '',
  position: { x: 10, y: 20 },
  estimatedSize: { width: 80, height: 40 },
  style: { opacity: '0.5', left: '3px' },
} satisfies PluginDisplayElementInternal;

describe('pluginElementLayout', () => {
  it('리사이즈 앵커 기준으로 위치 보정값을 계산한다', () => {
    expect(
      calculatePluginAnchorOffset(
        'bottom-right',
        { width: 100, height: 50 },
        { width: 140, height: 70 },
      ),
    ).toEqual({ dx: -40, dy: -20 });
    expect(
      calculatePluginAnchorOffset(
        'top-center',
        { width: 100, height: 50 },
        { width: 140, height: 70 },
      ),
    ).toEqual({ dx: -20, dy: 0 });
  });

  it('canonical 키 앵커와 오프셋으로 표시 위치를 결정한다', () => {
    expect(
      resolvePluginElementPosition({
        element: {
          ...element,
          anchor: { keyCode: 'KeyA', offset: { x: 4, y: -2 } },
        },
        positions: { '4key': [{ dx: 100, dy: 200 }] },
        keyMappings: { '4key': ['KeyA'] },
        selectedKeyType: '4key',
        positionOffset: { x: 10, y: 20 },
      }),
    ).toEqual({ x: 114, y: 218 });
  });

  it('창 유형별 transform과 resizable hit box 계약을 유지한다', () => {
    const mainStyle = buildPluginElementStyle({
      element,
      windowType: 'main',
      renderX: 12,
      renderY: 34,
      keyCount: 4,
      arrayIndex: 2,
      resizable: true,
    });
    expect(mainStyle).toMatchObject({
      left: '3px',
      transform: 'translate(12px, 34px)',
      zIndex: 6,
      pointerEvents: 'auto',
      width: 80,
      height: 40,
      opacity: '0.5',
    });

    const overlayStyle = buildPluginElementStyle({
      element,
      windowType: 'overlay',
      renderX: 12,
      renderY: 34,
      keyCount: 4,
      arrayIndex: 2,
      resizable: false,
    });
    expect(overlayStyle.transform).toBe('translate3d(12px, 34px, 0)');
    expect(
      buildPluginOverlayHitStyle(element, overlayStyle, 'overlay'),
    ).toMatchObject({
      left: '3px',
      width: 80,
      height: 40,
      pointerEvents: 'none',
    });
    expect(
      buildPluginOverlayHitStyle(element, mainStyle, 'main'),
    ).toBeUndefined();
  });
});
