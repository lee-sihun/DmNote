import { describe, expect, it } from 'vitest';

import { computeKeyElementStyles } from '@hooks/overlay/useKeyElementStyles';
import { gradientToCss } from '@src/types/color';
import type { KeyPosition } from '@src/types/key/keys';
import {
  DEFAULT_ELEMENT_BORDER_GRADIENT,
  DEFAULT_ELEMENT_BORDER_WIDTH,
} from '@utils/element/elementDefaults';

// 키·통계가 공유하는 스타일 계산이 기본 글래스 립을 렌더·패널과 같은 규칙으로 내는지 고정
const basePosition = (overrides: Partial<KeyPosition> = {}): KeyPosition =>
  ({
    dx: 0,
    dy: 0,
    width: 60,
    height: 60,
    ...overrides,
  } as KeyPosition);

const styleVars = (position: KeyPosition, active = false) => {
  const styles = computeKeyElementStyles({ position, active, label: 'A' });
  const vars = styles.keyStyle as Record<string, string | undefined>;
  return {
    ring: styles.borderRingStyle as Record<string, string> | null,
    border: vars['--dmn-key-border-default'],
    padding: vars['--dmn-key-padding-default'],
  };
};

describe('기본 테두리 립 계약', () => {
  it('아무 값도 없으면 1px 그라데이션 링과 패딩 예약', () => {
    const { ring, border, padding } = styleVars(basePosition());
    expect(border).toBe('none');
    expect(padding).toBe(`${DEFAULT_ELEMENT_BORDER_WIDTH}px`);
    expect(ring?.['--dmn-border-gradient-image-default']).toBe(
      gradientToCss(DEFAULT_ELEMENT_BORDER_GRADIENT),
    );
  });

  it('눌림 상태도 같은 두께의 링을 유지한다', () => {
    const { ring, padding } = styleVars(basePosition(), true);
    expect(ring).not.toBeNull();
    expect(padding).toBe('1px');
  });

  it('단색 테두리를 지정하면 링 대신 실보더', () => {
    const { ring, border, padding } = styleVars(
      basePosition({ borderColor: '#ff0000' }),
    );
    expect(ring).toBeNull();
    expect(border).toBe('1px solid #ff0000');
    expect(padding).toBe('0px');
  });

  it('두께 0은 테두리 없음', () => {
    const { ring, border } = styleVars(basePosition({ borderWidth: 0 }));
    expect(ring).toBeNull();
    expect(border).toBe('none');
  });

  it('두께만 키우면 기본 립을 그 두께로', () => {
    const { ring, padding } = styleVars(basePosition({ borderWidth: 3 }));
    expect(ring?.padding).toBe('3px');
    expect(padding).toBe('3px');
  });

  it('이미지 키는 기본 립을 내지 않는다', () => {
    const { ring, border } = styleVars(
      basePosition({ inactiveImage: 'file:///tmp/a.png' }),
    );
    expect(ring).toBeNull();
    expect(border).toBe('none');
  });
});
