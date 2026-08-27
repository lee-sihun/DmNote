import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_BORDER_GRADIENT,
} from './elementDefaults';
import {
  elementImageReplacesSurface,
  resolveElementBorder,
} from './elementBorder';

describe('resolveElementBorder', () => {
  it('아무 값도 없으면 기본 글래스 립 1px', () => {
    const result = resolveElementBorder({}, false);
    expect(result).toEqual({
      color: DEFAULT_ELEMENT_BORDER,
      gradient: DEFAULT_ELEMENT_BORDER_GRADIENT,
      width: 1,
      isDefault: true,
    });
  });

  it('두께만 지정하면 기본 립을 그 두께로', () => {
    const result = resolveElementBorder({ borderWidth: 3 }, false);
    expect(result.gradient).toBe(DEFAULT_ELEMENT_BORDER_GRADIENT);
    expect(result.width).toBe(3);
    expect(result.isDefault).toBe(true);
  });

  it('두께 0은 무보더지만 저장된 페인트는 유지한다', () => {
    const spec = {
      angle: 90,
      stops: [
        { color: '#000000', pos: 0 },
        { color: '#ffffff', pos: 1 },
      ],
    };
    const result = resolveElementBorder(
      { borderWidth: 0, borderColor: '#ff0000', borderGradient: spec },
      false,
    );
    expect(result.width).toBe(0);
    expect(result.color).toBe('#ff0000');
    expect(result.gradient).toBe(spec);
    expect(result.isDefault).toBe(false);
  });

  it('두께 0에 페인트가 없으면 기본 립도 내지 않는다', () => {
    const result = resolveElementBorder({ borderWidth: 0 }, false);
    expect(result.width).toBe(0);
    expect(result.gradient).toBeNull();
  });

  it('단색 지정 시 링 없이 그 색', () => {
    const result = resolveElementBorder({ borderColor: '#ff0000' }, false);
    expect(result).toEqual({
      color: '#ff0000',
      gradient: null,
      width: 1,
      isDefault: false,
    });
  });

  it('사용자 그라데이션은 기본 립을 대체', () => {
    const spec = {
      angle: 90,
      stops: [
        { color: '#000000', pos: 0 },
        { color: '#ffffff', pos: 1 },
      ],
    };
    const result = resolveElementBorder(
      { borderColor: '#000000', borderGradient: spec },
      false,
    );
    expect(result.gradient).toBe(spec);
    expect(result.color).toBe('#000000');
  });

  it('활성 쌍이 비어 있으면 대기 값을 따른다', () => {
    const result = resolveElementBorder({ borderColor: '#123456' }, true);
    expect(result.color).toBe('#123456');
    expect(result.gradient).toBeNull();
  });

  // 패널의 억제 판정은 렌더(imageReplaces)와 같아야 한다 - overlay에서 갈리면
  // 패널이 단색 피커를 열어 기본 립이 단색으로 커밋된다
  it('elementImageReplacesSurface는 replace 모드의 이미지 키만 참이다', () => {
    const img = 'file:///a.png';
    expect(elementImageReplacesSurface({ inactiveImage: img }, false)).toBe(
      true,
    );
    expect(
      elementImageReplacesSurface(
        { inactiveImage: img, imageMode: 'overlay' },
        false,
      ),
    ).toBe(false);
    expect(elementImageReplacesSurface({}, false)).toBe(false);
    // 활성 상태는 활성 이미지, 없으면 대기 이미지로 폴백
    expect(elementImageReplacesSurface({ inactiveImage: img }, true)).toBe(
      true,
    );
    expect(elementImageReplacesSurface({ activeImage: img }, false)).toBe(
      false,
    );
    expect(
      elementImageReplacesSurface(
        { activeImage: img, imageMode: 'replace' },
        true,
      ),
    ).toBe(true);
  });

  it('이미지 키는 기본 립을 내지 않지만 두께를 지정하면 그린다', () => {
    expect(
      resolveElementBorder({}, false, { suppressDefault: true }).width,
    ).toBe(0);
    expect(
      resolveElementBorder({ borderWidth: 2 }, false, { suppressDefault: true })
        .gradient,
    ).toBe(DEFAULT_ELEMENT_BORDER_GRADIENT);
  });
});
