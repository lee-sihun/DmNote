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
