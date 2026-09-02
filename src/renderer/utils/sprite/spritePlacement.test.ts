import { describe, expect, it } from 'vitest';

import { makeSpritePose, makeSpritePosition } from './spriteFixtures';
import {
  fitImageRectToNaturalSize,
  placeSpriteVisual,
  spriteIdleVisual,
  spritePoseVisual,
  spriteReferenceScale,
  spriteReferenceSize,
} from './spritePlacement';

// 상자 200x100, 기준 이미지 400x200(contain 배율 0.5), 축은 상자 가운데
const pivotSprite = () =>
  makeSpritePosition({
    baseImage: 'base.png',
    imageRect: { x: 10, y: 20, width: 200, height: 100 },
    pivot: { x: 0.5, y: 0.5 },
    imagePlacement: 'pivot',
    referenceNaturalSize: { source: 'base.png', width: 400, height: 200 },
  });

describe('spriteReferenceSize', () => {
  it('base가 있으면 base에 결합된 기준만 유효하다', () => {
    expect(spriteReferenceSize(pivotSprite())).toEqual({
      width: 400,
      height: 200,
    });
    expect(
      spriteReferenceSize({
        baseImage: 'other.png',
        referenceNaturalSize: { source: 'base.png', width: 400, height: 200 },
      }),
    ).toBeNull();
  });

  it('base가 없으면 결합 없는 기준만 유효하다', () => {
    expect(
      spriteReferenceSize({
        baseImage: null,
        referenceNaturalSize: { source: null, width: 300, height: 300 },
      }),
    ).toEqual({ width: 300, height: 300 });
    expect(
      spriteReferenceSize({
        baseImage: '',
        referenceNaturalSize: { source: 'gone.png', width: 300, height: 300 },
      }),
    ).toBeNull();
  });
});

describe('spriteReferenceScale', () => {
  it('box 모드는 배율이 없다', () => {
    expect(
      spriteReferenceScale({ ...pivotSprite(), imagePlacement: 'box' }),
    ).toBeNull();
  });

  it('fit별 배율 - contain은 min, cover는 max, fill은 축별', () => {
    const sprite = {
      ...pivotSprite(),
      imageRect: { x: 0, y: 0, width: 200, height: 200 },
    };
    expect(spriteReferenceScale({ ...sprite, imageFit: null })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(spriteReferenceScale({ ...sprite, imageFit: 'cover' })).toEqual({
      x: 1,
      y: 1,
    });
    expect(spriteReferenceScale({ ...sprite, imageFit: 'fill' })).toEqual({
      x: 0.5,
      y: 1,
    });
  });
});

describe('placeSpriteVisual', () => {
  it('box 모드는 저장된 imageRect·기준점 참조를 그대로 돌려준다', () => {
    const sprite = makeSpritePosition({ baseImage: 'base.png' });
    const placement = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
    expect(placement.rect).toBe(sprite.imageRect);
    expect(placement.pivot).toBe(sprite.pivot);
  });

  it('기준 이미지는 비율이 같으면 상자와 같은 자리에 놓인다', () => {
    const sprite = pivotSprite();
    const placement = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
    expect(placement.rect).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    expect(placement.pivot).toEqual({ x: 0.5, y: 0.5 });
  });

  it('비율이 다른 자세 이미지는 자기 축을 기준점에 맞추고 기준 배율로 그려진다', () => {
    const sprite = pivotSprite();
    const pose = makeSpritePose({
      poseId: 'p',
      imageOverride: 'hand.png',
      imageOverrideMetrics: { source: 'hand.png', width: 400, height: 400 },
      imagePivot: { x: 0.5, y: 1 },
    });
    const visual = spritePoseVisual(sprite, pose);
    expect(visual.sourcePoseId).toBe('p');
    const placement = placeSpriteVisual(sprite, visual);
    // 축 P=(110, 70), W·H=200, 축이 이미지 바닥 가운데
    expect(placement.rect).toEqual({ x: 10, y: -130, width: 200, height: 200 });
    expect(placement.pivot).toEqual({ x: 0.5, y: 1 });
  });

  it('자세 축이 없으면 스프라이트 기준점을 물려받는다', () => {
    const sprite = pivotSprite();
    const pose = makeSpritePose({
      imageOverride: 'hand.png',
      imageOverrideMetrics: { source: 'hand.png', width: 100, height: 100 },
    });
    expect(spritePoseVisual(sprite, pose).pivot).toBe(sprite.pivot);
  });

  it('경로가 어긋난 크기는 stale이라 box 배치로 폴백한다', () => {
    const sprite = pivotSprite();
    const pose = makeSpritePose({
      imageOverride: 'new.png',
      imageOverrideMetrics: { source: 'old.png', width: 400, height: 400 },
    });
    const visual = spritePoseVisual(sprite, pose);
    expect(visual.naturalSize).toBeNull();
    expect(placeSpriteVisual(sprite, visual).rect).toBe(sprite.imageRect);
  });

  it('공백 override는 기본 이미지 visual이다', () => {
    const sprite = pivotSprite();
    const visual = spritePoseVisual(
      sprite,
      makeSpritePose({ imageOverride: ' ' }),
    );
    expect(visual.src).toBe('base.png');
    expect(visual.sourcePoseId).toBeNull();
  });
});

describe('fitImageRectToNaturalSize', () => {
  it('상자를 이미지 비율로 줄이되 기준점 위치는 그대로 둔다', () => {
    const rect = { x: 10, y: 20, width: 200, height: 200 };
    // 가운데 기준점 - contain이 그리던 자리 그대로 상자만 감싼다
    expect(
      fitImageRectToNaturalSize(
        rect,
        { x: 0.5, y: 0.5 },
        { width: 400, height: 200 },
      ),
    ).toEqual({ x: 10, y: 70, width: 200, height: 100 });
    // 왼쪽 위 기준점 - 비트맵 왼쪽 위가 상자 왼쪽 위에 붙는다
    expect(
      fitImageRectToNaturalSize(
        rect,
        { x: 0, y: 0 },
        { width: 400, height: 200 },
      ),
    ).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    // 비율이 이미 같으면 변화 없음
    expect(
      fitImageRectToNaturalSize(
        rect,
        { x: 0.3, y: 0.9 },
        { width: 50, height: 50 },
      ),
    ).toEqual(rect);
  });
});
