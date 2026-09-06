import {
  spriteTriggerSetKey,
  type ReactiveSpritePosition,
  type SpritePose,
  type SpriteTransform,
} from '@src/types/key/sprites';

import {
  isRenderableImageRef,
  toRenderableImageRef,
} from '@utils/media/imageSource';

import { DEG_TO_RAD, RAD_TO_DEG } from './spriteGeometry';
import {
  spriteIdleVisual,
  spritePoseVisual,
  type SpriteVisual,
  type SpriteVisualSource,
} from './spritePlacement';

// 평균 벡터 길이가 이보다 작으면 방향이 정의되지 않은 것으로 본다 (정반대 각 조합)
const DEGENERATE_MEAN_VECTOR_EPSILON = 1e-9;

export interface SpriteTargetResolution {
  transform: SpriteTransform;
  imageSrc: string | null;
  /** 이미지·원본 크기·축 한 벌. 축은 평균하지 않고 이미지를 소유한 자세의 것을 쓴다 */
  visual: SpriteVisual;
}

export type SpriteResolutionSource = Pick<
  ReactiveSpritePosition,
  'poses' | 'idleTransform'
> &
  SpriteVisualSource;

// poseId 코드포인트 사전순, 로케일 무관 고정 순서
const byPoseId = (a: SpritePose, b: SpritePose): number => {
  if (a.poseId < b.poseId) return -1;
  if (a.poseId > b.poseId) return 1;
  return 0;
};

// atan2를 도 단위로 바꿀 때 부동소수점 오차가 ±180을 넘지 않게 고정
const clampRotation = (deg: number): number =>
  Math.min(180, Math.max(-180, deg));

// 정확 일치 조회 키 - 중복·순서를 무시한 트리거 집합의 정규형
const triggerSetKey = spriteTriggerSetKey;

interface PreparedPoses {
  // 스프라이트가 참조하는 트리거 전체 (중복 제거)
  allTriggers: string[];
  // 트리거 집합 정규형 -> poseId 사전순 첫 pose
  exactByKey: Map<string, SpritePose>;
  // 단일 트리거 pose - 키당 poseId 사전순 첫 하나, poseId 순서 유지
  uniqueSingles: Array<{ key: string; pose: SpritePose }>;
}

// poses 배열 identity 기준 캐시. 키 이벤트마다 재정렬·Set 재생성을 하지 않기 위한
// 사전 구조로, 오버레이 레이아웃 캐시가 변경 없는 스프라이트의 참조를 보존하므로
// 문서가 바뀌지 않는 한 재계산이 없다
const preparedPosesCache = new WeakMap<readonly SpritePose[], PreparedPoses>();

const preparePoses = (poses: readonly SpritePose[]): PreparedPoses => {
  const cached = preparedPosesCache.get(poses);
  if (cached) return cached;

  const sortedPoses = [...poses].sort(byPoseId);
  const triggerSeen = new Set<string>();
  const allTriggers: string[] = [];
  const exactByKey = new Map<string, SpritePose>();
  const coveredKeys = new Set<string>();
  const uniqueSingles: Array<{ key: string; pose: SpritePose }> = [];

  for (const pose of sortedPoses) {
    for (const trigger of pose.triggers) {
      if (triggerSeen.has(trigger)) continue;
      triggerSeen.add(trigger);
      allTriggers.push(trigger);
    }
    const key = triggerSetKey(pose.triggers);
    if (!exactByKey.has(key)) exactByKey.set(key, pose);
    const uniqueTriggers = new Set(pose.triggers);
    if (uniqueTriggers.size === 1) {
      const [only] = uniqueTriggers;
      if (!coveredKeys.has(only)) {
        coveredKeys.add(only);
        uniqueSingles.push({ key: only, pose });
      }
    }
  }

  const prepared: PreparedPoses = { allTriggers, exactByKey, uniqueSingles };
  preparedPosesCache.set(poses, prepared);
  return prepared;
};

// 어떤 눌림 조합에서도 선택될 수 있는 자세만. 도달 범위 계산이 해석 규칙과
// 갈리지 않도록 같은 전처리를 공유한다. 트리거가 비었거나(활성 집합이 비면
// 무조건 idle) 죽은 키를 가리키거나, 같은 트리거 집합의 뒤 순위 중복이면
// 영원히 선택되지 않는다
export const selectableSpritePoses = (
  poses: readonly SpritePose[],
  liveTriggerIds: ReadonlySet<string>,
): SpritePose[] => {
  const prepared = preparePoses(poses);
  const selectable = new Set<SpritePose>();
  for (const pose of prepared.exactByKey.values()) {
    if (
      pose.triggers.length > 0 &&
      pose.triggers.every((trigger) => liveTriggerIds.has(trigger))
    ) {
      selectable.add(pose);
    }
  }
  for (const { key, pose } of prepared.uniqueSingles) {
    if (liveTriggerIds.has(key)) selectable.add(pose);
  }
  return poses.filter((pose) => selectable.has(pose));
};

// 스프라이트가 참조하는 키 요소 id 전체 (중복 제거, poseId 사전순).
// 오버레이 잎의 눌림 구독 목록과 자세 해석이 같은 전처리 결과를 공유한다
export const spriteTriggerIds = (
  poses: readonly SpritePose[],
): readonly string[] => preparePoses(poses).allTriggers;

// 자세가 그릴 이미지 - 렌더 가능한 override가 있으면 그것, 아니면 기본 이미지.
// 공백 override는 이미지 없음이라 base를 가리지 않는다. 해석 분기와 편집기
// 프리뷰가 같은 폴백을 손으로 다시 쓰다가 갈렸던 자리라 한 곳에 모은다
export const resolvePoseImage = (
  imageOverride: string | null | undefined,
  baseImage: string | null,
): string | null => toRenderableImageRef(imageOverride) ?? baseImage;

// 눌린 키 집합만 읽는 순수 해석. 눌린 순서, 시각, 이전 상태에 의존하지 않는다
export const resolveSpriteTarget = (
  // 도달 범위 계산도 같은 해석을 돌린다 - 전체 위치가 아니라 해석에 쓰는 필드만 받는다
  sprite: SpriteResolutionSource,
  pressedKeyElementIds: ReadonlySet<string>,
): SpriteTargetResolution => {
  const prepared = preparePoses(sprite.poses);
  const idle = (): SpriteTargetResolution => ({
    transform: sprite.idleTransform,
    imageSrc: sprite.baseImage,
    visual: spriteIdleVisual(sprite),
  });

  // 1단계: 담당 키 중 지금 눌린 것, 담당 밖 키와 죽은 키 id는 여기서 걸러진다
  const active = new Set<string>();
  for (const trigger of prepared.allTriggers) {
    if (pressedKeyElementIds.has(trigger)) active.add(trigger);
  }

  // 2단계: 활성 키 없음, 저장된 참조 그대로 반환해 identity 보존
  if (active.size === 0) return idle();

  // 3단계: triggers 집합이 active와 정확히 같은 pose (순서와 중복 무시)
  const exactPose = prepared.exactByKey.get(triggerSetKey([...active]));
  if (exactPose) {
    return {
      transform: exactPose.transform,
      imageSrc: resolvePoseImage(exactPose.imageOverride, sprite.baseImage),
      visual: spritePoseVisual(sprite, exactPose),
    };
  }

  // 4단계: 활성 키별 단일 pose 균등 평균, 조합 pose는 참여하지 않는다
  // 키당 pose는 poseId 사전순 첫 하나 (사전 구조가 그 순서를 보존한다)
  const singles: SpritePose[] = [];
  for (const single of prepared.uniqueSingles) {
    if (active.has(single.key)) singles.push(single.pose);
  }

  // 활성 키가 전부 조합 pose에만 속하면 평균 대상이 없다, idle과 동일 처리
  if (singles.length === 0) return idle();

  // 원소 하나의 평균은 자기 자신, 참조 identity 보존
  if (singles.length === 1) {
    const [pose] = singles;
    return {
      transform: pose.transform,
      imageSrc: resolvePoseImage(pose.imageOverride, sprite.baseImage),
      visual: spritePoseVisual(sprite, pose),
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumScale = 0;
  let sumSin = 0;
  let sumCos = 0;
  for (const pose of singles) {
    sumX += pose.transform.x;
    sumY += pose.transform.y;
    sumScale += pose.transform.scale;
    const rad = pose.transform.rotation * DEG_TO_RAD;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }

  const count = singles.length;

  // rotation은 산술 평균 금지, +170과 -170의 정답은 0이 아니라 180
  // 정반대 각끼리는 평균 벡터가 0이라 방향이 불안정, poseId 사전순 첫 자세로 폴백
  const meanVectorLength = Math.hypot(sumSin, sumCos) / count;
  const rotation =
    meanVectorLength < DEGENERATE_MEAN_VECTOR_EPSILON
      ? singles[0].transform.rotation
      : clampRotation(Math.atan2(sumSin, sumCos) * RAD_TO_DEG);

  // poseId 사전순 첫 imageOverride, 없으면 baseImage. 축·원본 크기도 그 이미지를
  // 소유한 자세의 것 - 다른 그림의 축을 평균하면 어느 그림도 가리키지 않는다
  let imageSrc = sprite.baseImage;
  let visual = spriteIdleVisual(sprite);
  for (const pose of singles) {
    if (isRenderableImageRef(pose.imageOverride)) {
      imageSrc = pose.imageOverride;
      visual = spritePoseVisual(sprite, pose);
      break;
    }
  }

  return {
    transform: {
      x: sumX / count,
      y: sumY / count,
      rotation,
      scale: sumScale / count,
    },
    imageSrc,
    visual,
  };
};
