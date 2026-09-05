import type { SpritePose } from '@src/types/key/sprites';
import { findDuplicateTriggerPose } from '@src/types/key/sprites';
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

const canCommitPoses = (poses: SpritePose[]): boolean =>
  poses.every((pose) => pose.triggers.length > 0) &&
  findDuplicateTriggerPose(poses) === null;

// 다른 미완성 상태가 있어도 명시적으로 편집한 상태는 최신 문서 위에 따로 저장
export const resolveSpritePoseCommit = (
  base: readonly SpritePose[],
  intended: readonly SpritePose[],
  current: readonly SpritePose[],
  targetPoseId?: string,
): { poses: SpritePose[]; partial: boolean } | null => {
  if (
    targetPoseId &&
    base.some((pose) => pose.poseId === targetPoseId) &&
    !current.some((pose) => pose.poseId === targetPoseId)
  ) {
    return null;
  }
  // 아직 착지하지 않았던 로컬 추가도 명시적 삭제 대상이면 다시 남기지 않음
  const currentPoses =
    targetPoseId && !intended.some((pose) => pose.poseId === targetPoseId)
      ? current.filter((pose) => pose.poseId !== targetPoseId)
      : current;
  const poses = rebaseSpritePoseIntent(base, intended, currentPoses);
  if (canCommitPoses(poses)) return { poses, partial: false };
  if (!targetPoseId) return null;

  const isTarget = (pose: SpritePose) => pose.poseId === targetPoseId;
  const currentById = new Map(currentPoses.map((pose) => [pose.poseId, pose]));
  // 비대상 상태는 최신값을 유지하면서 새 상태의 삽입 위치만 제공
  const targetIntent = intended.flatMap((pose) => {
    const candidate = isTarget(pose) ? pose : currentById.get(pose.poseId);
    return candidate ? [candidate] : [];
  });
  const targetPoses = rebaseSpritePoseIntent(
    base.filter(isTarget),
    targetIntent,
    currentPoses,
  );
  if (
    (intended.some(isTarget) && !targetPoses.some(isTarget)) ||
    !canCommitPoses(targetPoses)
  ) {
    return null;
  }
  return { poses: targetPoses, partial: true };
};
