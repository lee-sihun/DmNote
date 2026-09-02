import { describe, expect, it } from 'vitest';

import { makeSpritePose, makeSpritePosition } from './spriteFixtures';
import {
  pivotPlacementImageSources,
  planPivotPlacementCommit,
} from './spritePlacementSwitch';

const size = (width: number, height: number) => ({ width, height });

describe('pivotPlacementImageSources', () => {
  it('base와 자세 override를 중복 없이 모으고 공백은 뺀다', () => {
    const sprite = makeSpritePosition({
      baseImage: 'base.png',
      poses: [
        makeSpritePose({ poseId: 'a', imageOverride: 'hand.png' }),
        makeSpritePose({ poseId: 'b', imageOverride: 'hand.png' }),
        makeSpritePose({ poseId: 'c', imageOverride: '  ' }),
      ],
    });
    expect(pivotPlacementImageSources(sprite)).toEqual([
      'base.png',
      'hand.png',
    ]);
  });
});

describe('planPivotPlacementCommit', () => {
  it('최신 자세에 읽은 크기를 경로 기준으로 병합하고 기준은 base에 결합한다', () => {
    const latest = makeSpritePosition({
      baseImage: 'base.png',
      poses: [
        makeSpritePose({ poseId: 'a', imageOverride: 'hand.png' }),
        makeSpritePose({ poseId: 'b', imageOverride: null }),
      ],
    });
    const plan = planPivotPlacementCommit(
      latest,
      new Map([
        ['base.png', size(400, 200)],
        ['hand.png', size(100, 300)],
      ]),
    );
    expect(plan?.referenceNaturalSize).toEqual({
      source: 'base.png',
      width: 400,
      height: 200,
    });
    expect(plan?.poses[0].imageOverrideMetrics).toEqual({
      source: 'hand.png',
      width: 100,
      height: 300,
    });
    expect(plan?.poses[1]).toBe(latest.poses[1]);
  });

  it('읽는 동안 이미지가 바뀌어 크기가 없는 경로가 생기면 계획을 포기한다', () => {
    const latest = makeSpritePosition({
      baseImage: 'base.png',
      poses: [makeSpritePose({ poseId: 'a', imageOverride: 'new.png' })],
    });
    expect(
      planPivotPlacementCommit(
        latest,
        new Map([
          ['base.png', size(1, 1)],
          ['old.png', size(1, 1)],
        ]),
      ),
    ).toBeNull();
    expect(
      planPivotPlacementCommit(
        { ...latest, baseImage: 'moved.png' },
        new Map([['base.png', size(1, 1)]]),
      ),
    ).toBeNull();
  });

  it('base가 없으면 결합 없는 기존 기준을 두고, 없으면 첫 자세 이미지로 초기화한다', () => {
    const kept = planPivotPlacementCommit(
      makeSpritePosition({
        baseImage: null,
        referenceNaturalSize: { source: null, width: 50, height: 60 },
        poses: [makeSpritePose({ poseId: 'a', imageOverride: 'hand.png' })],
      }),
      new Map([['hand.png', size(100, 300)]]),
    );
    expect(kept?.referenceNaturalSize).toEqual({
      source: null,
      width: 50,
      height: 60,
    });
    const initialized = planPivotPlacementCommit(
      makeSpritePosition({
        baseImage: null,
        referenceNaturalSize: { source: 'gone.png', width: 1, height: 1 },
        poses: [makeSpritePose({ poseId: 'a', imageOverride: 'hand.png' })],
      }),
      new Map([['hand.png', size(100, 300)]]),
    );
    expect(initialized?.referenceNaturalSize).toEqual({
      source: null,
      width: 100,
      height: 300,
    });
    // 이미지가 하나도 없으면 기준도 없다
    expect(
      planPivotPlacementCommit(makeSpritePosition(), new Map())
        ?.referenceNaturalSize,
    ).toBeNull();
  });
});
