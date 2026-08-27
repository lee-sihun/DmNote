import { describe, expect, it } from 'vitest';

import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from './useKeyElementStyles';

const IMAGE = 'file:///images/key.png';
const ACTIVE_IMAGE = 'file:///images/key-active.png';

const base: KeyElementPosition = { dx: 0, dy: 0, width: 60, height: 60 };

describe('computeKeyElementStyles 이미지 레이어', () => {
  it('디코드에 실패한 src는 없는 이미지로 취급해 배경·라벨이 복귀한다', () => {
    const withImage = computeKeyElementStyles({
      position: { ...base, inactiveImage: IMAGE },
      active: false,
      label: 'A',
    });
    expect(withImage.hasCurrentImage).toBe(true);
    expect(withImage.imageReplaces).toBe(true);

    const failed = computeKeyElementStyles({
      position: { ...base, inactiveImage: IMAGE },
      active: false,
      label: 'A',
      failedImageSrcs: new Set([IMAGE]),
    });
    expect(failed.hasCurrentImage).toBe(false);
    expect(failed.imageReplaces).toBe(false);
    expect(failed.currentImageSrc).toBeNull();
    // 이미지 없는 키와 같은 스타일 - 기본 립도 다시 나온다
    expect(failed.borderRingStyle).not.toBeNull();
  });

  it('활성 이미지만 실패하면 대기 이미지로 폴백한다', () => {
    const styles = computeKeyElementStyles({
      position: { ...base, inactiveImage: IMAGE, activeImage: ACTIVE_IMAGE },
      active: true,
      label: 'A',
      failedImageSrcs: new Set([ACTIVE_IMAGE]),
    });
    expect(styles.currentImageSrc).toBe(IMAGE);
    expect(styles.hasCurrentImage).toBe(true);
  });

  // replace는 루트 overflow:hidden이 자르므로 paint containment 유지, overlay만 제외
  it('contain은 replace에서 유지되고 overlay에서만 paint를 뺀다', () => {
    const contain = (position: KeyElementPosition) =>
      computeKeyElementStyles({ position, active: false, label: 'A' }).keyStyle
        .contain;
    expect(contain(base)).toBe('layout style paint');
    expect(contain({ ...base, inactiveImage: IMAGE })).toBe(
      'layout style paint',
    );
    expect(
      contain({ ...base, inactiveImage: IMAGE, imageMode: 'overlay' }),
    ).toBe('layout style');
  });

  // 링은 DOM상 img보다 앞이라 z를 주지 않으면 replace 이미지(z 0)가 덮는다
  it('보더 링은 replace 이미지 위·overlay 이미지 아래에 선다', () => {
    const styles = computeKeyElementStyles({
      position: {
        ...base,
        inactiveImage: IMAGE,
        imageMode: 'overlay',
      },
      active: false,
      label: 'A',
    });
    expect(styles.borderRingStyle?.zIndex).toBe(1);
  });
});
