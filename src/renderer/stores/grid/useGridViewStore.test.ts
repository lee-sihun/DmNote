import { describe, expect, it } from 'vitest';
import {
  snapGridPositionToDevicePixel,
  useGridViewStore,
} from './useGridViewStore';

describe('snapGridPositionToDevicePixel', () => {
  it('Retina 화면의 반 픽셀 좌표에 팬 위치를 맞춘다', () => {
    expect(snapGridPositionToDevicePixel(12.24, 2)).toBe(12);
    expect(snapGridPositionToDevicePixel(12.26, 2)).toBe(12.5);
  });

  it('Windows 배율과 잘못된 배율에서도 유효한 좌표를 반환한다', () => {
    expect(snapGridPositionToDevicePixel(3.1, 1.25)).toBe(3.2);
    expect(snapGridPositionToDevicePixel(3.6, 0)).toBe(4);
  });

  it('작은 입력이 누적되도록 원본 팬 좌표를 보존한다', () => {
    useGridViewStore.setState({
      viewStates: { saved: { zoom: 1, panX: 10.24, panY: -4.74 } },
    });

    expect(useGridViewStore.getState().getViewState('saved')).toEqual({
      zoom: 1,
      panX: 10.24,
      panY: -4.74,
    });
  });
});
