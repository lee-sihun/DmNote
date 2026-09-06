import {
  normalizeSpriteTriggers,
  type ReactiveSpritePosition,
  type SpritePose,
} from '@src/types/key/sprites';

// 클릭 순서 그대로 커밋하면 ack 문서와 로컬 store의 배열 순서가 갈려
// 이후 낙관 적용 소유권 CAS가 영구히 실패한다. 이미 정규형이면 원본 반환
const normalizeTriggers = (triggers: string[]): string[] => {
  let ordered = true;
  for (let i = 1; i < triggers.length; i += 1) {
    if (triggers[i - 1] >= triggers[i]) {
      ordered = false;
      break;
    }
  }
  if (ordered) return triggers;
  return normalizeSpriteTriggers(triggers);
};

// 자세 name도 같은 관례 - None이면 키 생략
const toPoseWireShape = (pose: SpritePose): SpritePose => {
  const triggers = normalizeTriggers(pose.triggers);
  const dropName = pose.name == null && 'name' in pose;
  if (triggers === pose.triggers && !dropName) return pose;
  const next = { ...pose, triggers };
  if (dropName) delete next.name;
  return next;
};

// 백엔드는 layerName·groupId(위치)와 name(자세)이 None이면 키를 직렬화에서 생략하고,
// 자세 triggers는 커밋 시 정렬·중복 제거한다. 프론트 생성·병합 경로가 명시 null이나
// 클릭순 트리거를 남기면 스토어와 ack 문서가 갈라져 낙관 적용 소유권 검사가
// 조용히 스킵되므로 이 키들을 wire 형태로 맞춘다.
// 대상은 정확히 이 필드들뿐 - baseImage 등 다른 null 필드는 백엔드가
// null을 그대로 직렬화한다
export const toSpriteWireShape = <T extends ReactiveSpritePosition>(
  position: T,
): T => {
  const dropLayerName = position.layerName == null && 'layerName' in position;
  const dropGroupId = position.groupId == null && 'groupId' in position;
  const nextPoses = position.poses.map(toPoseWireShape);
  const posesChanged = nextPoses.some(
    (pose, index) => pose !== position.poses[index],
  );
  if (!dropLayerName && !dropGroupId && !posesChanged) return position;
  const next: ReactiveSpritePosition = { ...position };
  if (dropLayerName) delete next.layerName;
  if (dropGroupId) delete next.groupId;
  if (posesChanged) next.poses = nextPoses;
  return next as T;
};
