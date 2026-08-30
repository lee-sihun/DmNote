import type {
  ReactiveSpritePosition,
  SpritePose,
} from '@src/types/key/sprites';

// 자세 name도 같은 관례 - None이면 키 생략
const toPoseWireShape = (pose: SpritePose): SpritePose => {
  if (!(pose.name == null && 'name' in pose)) return pose;
  const next = { ...pose };
  delete next.name;
  return next;
};

// 백엔드는 layerName·groupId(위치)와 name(자세)이 None이면 키를 직렬화에서 생략한다.
// 프론트 생성·병합 경로가 명시 null을 남기면 스토어와 ack 문서가 갈라져
// 낙관 적용 소유권 검사가 조용히 스킵되므로 이 키들을 wire 형태로 맞춘다.
// 대상은 정확히 이 필드들뿐 - baseImage 등 다른 null 필드는 백엔드가
// null을 그대로 직렬화한다
export const toSpriteWireShape = <T extends ReactiveSpritePosition>(
  position: T,
): T => {
  const dropLayerName = position.layerName == null && 'layerName' in position;
  const dropGroupId = position.groupId == null && 'groupId' in position;
  const dropPoseNames = position.poses.some(
    (pose) => pose.name == null && 'name' in pose,
  );
  if (!dropLayerName && !dropGroupId && !dropPoseNames) return position;
  const next: ReactiveSpritePosition = { ...position };
  if (dropLayerName) delete next.layerName;
  if (dropGroupId) delete next.groupId;
  if (dropPoseNames) next.poses = position.poses.map(toPoseWireShape);
  return next as T;
};
