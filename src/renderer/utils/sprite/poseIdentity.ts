import type { SpritePose } from '@src/types/key/sprites';

// 복제·붙여넣기 사본의 poseId 재발급. 원본과 poseId를 공유하면 백엔드가
// 중복 poseId 커밋을 거부한다. 트리거·변환·이미지는 그대로 유지
export const reissueSpritePoseIds = (
  poses: readonly SpritePose[],
): SpritePose[] =>
  poses.map((pose) => ({ ...pose, poseId: crypto.randomUUID() }));
