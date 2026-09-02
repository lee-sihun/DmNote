import type {
  ReactiveSpritePosition,
  SpritePose,
  SpriteReferenceNaturalSize,
} from '@src/types/key/sprites';

import { toRenderableImageRef } from '@utils/core/imageSource';

import type { SpriteNaturalSize } from './spritePlacement';

// 상자 맞춤 → 축 배치 전환 계획. 이미지를 읽는 동안 사용자가 자세를 고치거나 이미지를
// 바꿀 수 있으므로, 읽기 결과는 경로(source)로만 보관하고 커밋 직전의 최신 문서에
// 병합한다. 최신 문서가 읽지 않은 경로를 가리키면 계획을 포기한다(호출부가 다시 시도)

export type SpriteImageProbes = ReadonlyMap<string, SpriteNaturalSize>;

export interface PivotPlacementCommit {
  referenceNaturalSize: SpriteReferenceNaturalSize | null;
  poses: SpritePose[];
}

/** 전환에 읽어야 하는 이미지 경로 - base와 자세 override, 중복 제거 */
export const pivotPlacementImageSources = (
  sprite: Pick<ReactiveSpritePosition, 'baseImage' | 'poses'>,
): string[] => {
  const sources = new Set<string>();
  const base = toRenderableImageRef(sprite.baseImage);
  if (base !== null) sources.add(base);
  for (const pose of sprite.poses) {
    const override = toRenderableImageRef(pose.imageOverride);
    if (override !== null) sources.add(override);
  }
  return [...sources];
};

/**
 * 최신 문서에 읽은 크기를 병합한 커밋 계획. 기준 크기는 base가 있으면 base에 결합,
 * base가 없으면 기존 결합 없는 값을 두고, 그것도 없으면 첫 자세 이미지 크기로 초기화
 */
export const planPivotPlacementCommit = (
  latest: Pick<
    ReactiveSpritePosition,
    'baseImage' | 'referenceNaturalSize' | 'poses'
  >,
  probes: SpriteImageProbes,
): PivotPlacementCommit | null => {
  const base = toRenderableImageRef(latest.baseImage);
  const baseSize = base !== null ? probes.get(base) ?? null : null;
  if (base !== null && !baseSize) return null;

  const poses: SpritePose[] = [];
  let firstOverrideSize: SpriteNaturalSize | null = null;
  for (const pose of latest.poses) {
    const override = toRenderableImageRef(pose.imageOverride);
    if (override === null) {
      poses.push(pose);
      continue;
    }
    const size = probes.get(override);
    if (!size) return null;
    firstOverrideSize ??= size;
    poses.push({
      ...pose,
      imageOverrideMetrics: { source: override, ...size },
    });
  }

  let referenceNaturalSize: SpriteReferenceNaturalSize | null;
  if (base !== null && baseSize) {
    referenceNaturalSize = { source: base, ...baseSize };
  } else if (
    latest.referenceNaturalSize &&
    latest.referenceNaturalSize.source === null
  ) {
    referenceNaturalSize = latest.referenceNaturalSize;
  } else if (firstOverrideSize) {
    referenceNaturalSize = { source: null, ...firstOverrideSize };
  } else {
    referenceNaturalSize = null;
  }
  return { referenceNaturalSize, poses };
};
