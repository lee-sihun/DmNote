import type { SpritePose } from '@src/types/key/sprites';

// 복제·붙여넣기 사본의 poseId 재발급. 원본과 poseId를 공유하면 백엔드가
// 중복 poseId 커밋을 거부한다. 트리거·변환·이미지는 그대로 유지
export const reissueSpritePoseIds = (
  poses: readonly SpritePose[],
): SpritePose[] =>
  poses.map((pose) => ({ ...pose, poseId: crypto.randomUUID() }));

// 배치 복제 사본의 트리거 재결합. 같은 배치에서 함께 복제된 키의 신 id로
// 치환하고, 배치 밖 키를 가리키는 트리거는 그대로 유지
export const remapSpritePoseTriggers = (
  poses: readonly SpritePose[],
  keyIdMap: ReadonlyMap<string, string>,
): SpritePose[] =>
  poses.map((pose) => ({
    ...pose,
    triggers: pose.triggers.map((id) => keyIdMap.get(id) ?? id),
  }));

// 다른 탭으로 옮길 때 트리거를 같은 키에 다시 결합한다. 요소 id는 문서 전역
// 유일이라 그대로 두면 대상 탭에서 절대 해석되지 않는다. 트리거를 비우면 백엔드가
// EMPTY_SPRITE_POSE_TRIGGERS로 커밋을 막고, 자세를 지우면 변환과 이미지까지
// 사라지므로 둘 다 하지 않는다. 대상 탭에 같은 키가 정확히 하나일 때만 옮기고,
// 없거나 모호하면 원본 참조를 남겨 패널의 "삭제된 키" 표시로 직접 고치게 한다
export const rebindPoseTriggersByKey = (
  poses: readonly SpritePose[],
  triggerCanonicals: Readonly<Record<string, string>>,
  targetKeyIdsByCanonical: ReadonlyMap<string, readonly string[]>,
): SpritePose[] =>
  poses.map((pose) => ({
    ...pose,
    triggers: pose.triggers.map((trigger) => {
      const canonical = triggerCanonicals[trigger];
      if (canonical === undefined) return trigger;
      const candidates = targetKeyIdsByCanonical.get(canonical);
      return candidates && candidates.length === 1 ? candidates[0] : trigger;
    }),
  }));
