import { describe, expect, it } from 'vitest';
import { computeCounterAnimationPreviewKeyStyles } from '@utils/counter/counterAnimationPreview';
import type { GradientSpec } from '@src/types/color';

const ring: GradientSpec = {
  angle: 90,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#0000ff', pos: 1 },
  ],
};

describe('카운터 애니메이션 키 프리뷰 계약', () => {
  it('이미지 키는 실제 렌더처럼 이미지와 fit을 쓰고 기본 표면을 억제한다', () => {
    const idle = computeCounterAnimationPreviewKeyStyles({
      keyVisual: {
        inactiveImage: 'data:image/png;base64,AA==',
        idleImageFit: 'contain',
      },
      active: false,
      width: 60,
      height: 60,
    });
    const active = computeCounterAnimationPreviewKeyStyles({
      keyVisual: {
        inactiveImage: 'data:image/png;base64,AA==',
        idleImageFit: 'contain',
      },
      active: true,
      width: 60,
      height: 60,
    });

    expect(idle.hasCurrentImage).toBe(true);
    expect(idle.currentImageSrc).toBe('data:image/png;base64,AA==');
    expect(idle.imageStyle['--dmn-key-image-fit-default']).toBe('contain');
    expect(idle.keyStyle['--dmn-key-bg-default']).toBe('transparent');
    expect(idle.keyStyle['--dmn-key-border-default']).toBe('none');
    expect(idle.keyStyle['--dmn-key-shadow-default']).toBe('none');
    expect(active.imageStyle.filter).toBe('brightness(0.62)');
  });

  it('한 상태에만 링이 있어도 반대 상태의 패딩을 예약한다', () => {
    const idle = computeCounterAnimationPreviewKeyStyles({
      keyVisual: {
        activeBorderGradient: ring,
        inactiveImage: 'data:image/png;base64,AA==',
      },
      active: false,
      width: 60,
      height: 60,
    });

    expect(idle.borderRingStyle).toBeNull();
    expect(idle.keyStyle['--dmn-key-padding-default']).toBe('1px');
  });

  it('현재 상태의 투명도 설정을 그대로 반환한다', () => {
    const active = computeCounterAnimationPreviewKeyStyles({
      keyVisual: { activeTransparent: true },
      active: true,
      width: 60,
      height: 60,
    });

    expect(active.isTransparent).toBe(true);
  });
});
