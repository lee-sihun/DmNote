import type {
  ReactiveSpritePosition,
  SpritePose,
  SpriteTransform,
} from '@src/types/key/sprites';

// 평균 벡터 길이가 이보다 작으면 방향이 정의되지 않은 것으로 본다 (정반대 각 조합)
const DEGENERATE_MEAN_VECTOR_EPSILON = 1e-9;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface SpriteTargetResolution {
  transform: SpriteTransform;
  imageSrc: string | null;
}

// poseId 코드포인트 사전순, 로케일 무관 고정 순서
const byPoseId = (a: SpritePose, b: SpritePose): number => {
  if (a.poseId < b.poseId) return -1;
  if (a.poseId > b.poseId) return 1;
  return 0;
};

// atan2를 도 단위로 바꿀 때 부동소수점 오차가 ±180을 넘지 않게 고정
const clampRotation = (deg: number): number =>
  Math.min(180, Math.max(-180, deg));

const setEquals = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
};

// 눌린 키 집합만 읽는 순수 해석. 눌린 순서, 시각, 이전 상태에 의존하지 않는다
export const resolveSpriteTarget = (
  sprite: ReactiveSpritePosition,
  pressedKeyElementIds: ReadonlySet<string>,
): SpriteTargetResolution => {
  const sortedPoses = [...sprite.poses].sort(byPoseId);

  // 1단계: 담당 키 중 지금 눌린 것, 담당 밖 키와 죽은 키 id는 여기서 걸러진다
  const active = new Set<string>();
  for (const pose of sortedPoses) {
    for (const trigger of pose.triggers) {
      if (pressedKeyElementIds.has(trigger)) active.add(trigger);
    }
  }

  // 2단계: 활성 키 없음, 저장된 참조 그대로 반환해 identity 보존
  if (active.size === 0) {
    return { transform: sprite.idleTransform, imageSrc: sprite.baseImage };
  }

  // 3단계: triggers 집합이 active와 정확히 같은 pose (순서와 중복 무시)
  for (const pose of sortedPoses) {
    if (setEquals(new Set(pose.triggers), active)) {
      return {
        transform: pose.transform,
        imageSrc: pose.imageOverride ?? sprite.baseImage,
      };
    }
  }

  // 4단계: 활성 키별 단일 pose 균등 평균, 조합 pose는 참여하지 않는다
  // 단일 여부는 중복을 무시한 집합 크기 기준, 키당 pose는 poseId 사전순 첫 하나
  const singles: SpritePose[] = [];
  const coveredKeys = new Set<string>();
  for (const pose of sortedPoses) {
    const triggerSet = new Set(pose.triggers);
    if (triggerSet.size !== 1) continue;
    const [key] = triggerSet;
    if (!active.has(key) || coveredKeys.has(key)) continue;
    coveredKeys.add(key);
    singles.push(pose);
  }

  // 활성 키가 전부 조합 pose에만 속하면 평균 대상이 없다, idle과 동일 처리
  if (singles.length === 0) {
    return { transform: sprite.idleTransform, imageSrc: sprite.baseImage };
  }

  // 원소 하나의 평균은 자기 자신, 참조 identity 보존
  if (singles.length === 1) {
    const [pose] = singles;
    return {
      transform: pose.transform,
      imageSrc: pose.imageOverride ?? sprite.baseImage,
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

  // poseId 사전순 첫 imageOverride, 없으면 baseImage
  let imageSrc = sprite.baseImage;
  for (const pose of singles) {
    if (pose.imageOverride != null) {
      imageSrc = pose.imageOverride;
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
  };
};
