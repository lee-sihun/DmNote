import type { SpritePose } from '@src/types/key/sprites';
import { stableStringify } from '@utils/core/stableStringify';

const POSE_INTENT_FIELDS = [
  'name',
  'triggers',
  'transform',
  'pivot',
  'imageOverride',
  'imageOverrideMetrics',
] as const satisfies ReadonlyArray<keyof SpritePose>;

const applyPoseFieldIntent = (
  base: SpritePose,
  intended: SpritePose,
  current: SpritePose,
): SpritePose => {
  let next = current;
  for (const field of POSE_INTENT_FIELDS) {
    if (stableStringify(base[field]) === stableStringify(intended[field])) {
      continue;
    }
    if (next === current) next = { ...current };
    Object.assign(next, { [field]: intended[field] });
  }
  return next;
};

// 호출 시점의 변경 의도만 직렬 슬롯의 최신 상태 목록에 다시 적용
export const rebaseSpritePoseIntent = (
  base: readonly SpritePose[],
  intended: readonly SpritePose[],
  current: readonly SpritePose[],
): SpritePose[] => {
  const baseById = new Map(base.map((pose) => [pose.poseId, pose]));
  const intendedById = new Map(intended.map((pose) => [pose.poseId, pose]));

  // 호출 시점에 존재했던 상태만 삭제 대상으로 삼아 동시 추가를 보존
  const next = current
    .filter(
      (pose) => !baseById.has(pose.poseId) || intendedById.has(pose.poseId),
    )
    .map((pose) => {
      const basePose = baseById.get(pose.poseId);
      const intendedPose = intendedById.get(pose.poseId);
      if (!intendedPose) return pose;
      // 같은 로컬 추가가 먼저 착지했다면 최신 초안 전체가 그 추가의 후속 의도
      if (!basePose) return { ...pose, ...intendedPose };
      return applyPoseFieldIntent(basePose, intendedPose, pose);
    });

  const present = new Set(next.map((pose) => pose.poseId));
  intended.forEach((pose, intendedIndex) => {
    if (present.has(pose.poseId) || baseById.has(pose.poseId)) return;

    let insertAt = next.length;
    for (let index = intendedIndex - 1; index >= 0; index -= 1) {
      const previousIndex = next.findIndex(
        (candidate) => candidate.poseId === intended[index].poseId,
      );
      if (previousIndex >= 0) {
        insertAt = previousIndex + 1;
        break;
      }
    }
    if (insertAt === next.length) {
      for (let index = intendedIndex + 1; index < intended.length; index += 1) {
        const followingIndex = next.findIndex(
          (candidate) => candidate.poseId === intended[index].poseId,
        );
        if (followingIndex >= 0) {
          insertAt = followingIndex;
          break;
        }
      }
    }
    next.splice(insertAt, 0, pose);
    present.add(pose.poseId);
  });

  return next;
};
