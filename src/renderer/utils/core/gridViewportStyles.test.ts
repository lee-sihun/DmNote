import { describe, expect, it } from 'vitest';
import { getGridViewportLayerStyles } from './gridViewportStyles';

describe('getGridViewportLayerStyles', () => {
  it('팬과 줌을 서로 다른 합성 레이어에 둔다', () => {
    const styles = getGridViewportLayerStyles(-64, -31.5, 1.1, true);

    expect(styles.pan).toMatchObject({
      transform: 'translate(-64px, -31.5px)',
      willChange: 'transform',
    });
    expect(styles.scale.transform).toBe('scale(1.1)');
    expect(styles.pan.transform).not.toContain('scale');
  });

  it('100%에서는 불필요한 배율 변환을 만들지 않는다', () => {
    const styles = getGridViewportLayerStyles(0, 0, 1, false);

    expect(styles.pan.willChange).toBe('auto');
    expect(styles.scale.transform).toBe('none');
  });
});
