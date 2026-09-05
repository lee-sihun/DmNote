import { describe, expect, it, vi } from 'vitest';
import {
  measureConnectedPluginElement,
  resolveResizablePluginElementSize,
} from './pluginElementMeasurement';

const measurable = (width: number, height: number, isConnected = true) => ({
  isConnected,
  getBoundingClientRect: vi.fn(() => ({ width, height })),
});

describe('플러그인 요소 크기 측정', () => {
  it('리사이즈 요소의 첫 크기를 200x150으로 제공한다', () => {
    expect(resolveResizablePluginElementSize({})).toEqual({
      width: 200,
      height: 150,
    });
  });

  it('추정 크기를 기본 크기보다 우선한다', () => {
    expect(
      resolveResizablePluginElementSize({
        estimatedSize: { width: 240, height: 160 },
      }),
    ).toEqual({ width: 240, height: 160 });
  });

  it('측정 크기를 추정 크기보다 우선한다', () => {
    expect(
      resolveResizablePluginElementSize({
        measuredSize: { width: 102, height: 8 },
        estimatedSize: { width: 240, height: 160 },
      }),
    ).toEqual({ width: 102, height: 8 });
  });

  it('연결된 요소의 화면 크기를 줌 기준 정수로 변환한다', () => {
    expect(measureConnectedPluginElement(measurable(101, 51), 2)).toEqual({
      width: 51,
      height: 26,
    });
  });

  it('DOM에서 분리된 요소를 측정하지 않는다', () => {
    const element = measurable(60, 72, false);

    expect(measureConnectedPluginElement(element, 1)).toBeNull();
    expect(element.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it.each([
    [0, 72],
    [60, 0],
    [Number.NaN, 72],
    [60, Number.POSITIVE_INFINITY],
  ])('유효하지 않은 일시 크기 %s x %s를 거부한다', (width, height) => {
    expect(
      measureConnectedPluginElement(measurable(width, height), 1),
    ).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '유효하지 않은 줌 %s에서 측정하지 않는다',
    (zoom) => {
      const element = measurable(60, 72);

      expect(measureConnectedPluginElement(element, zoom)).toBeNull();
      expect(element.getBoundingClientRect).not.toHaveBeenCalled();
    },
  );
});
