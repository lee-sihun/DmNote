'use no memo';
import React, { useEffect, useMemo } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getKeySignal } from '@stores/signals/keySignals';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import { resolveImageSource } from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import { resolveSpriteTarget } from '@utils/sprite/poseResolver';
import { spriteTransformToCss } from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

interface OverlaySpriteItemProps {
  position: CanonicalReactiveSpritePosition;
  keyCanonicalMap: ReadonlyMap<string, string>;
}

// 키 입력에 따라 자세가 바뀌는 반응형 스프라이트 잎 컴포넌트.
// 담당 키 시그널을 여기서만 읽어 눌림 변화가 이 잎의 리렌더로만 남는다.
// 변환은 CSS transition이 컴포지터에서 보간하고 자세 이미지는 스냅 교체 (계약 §9)
const OverlaySpriteItem = React.memo(function OverlaySpriteItem({
  position,
  keyCanonicalMap,
}: OverlaySpriteItemProps) {
  useSignals();

  // 자세들이 참조하는 키 요소 id 전체 (중복 제거)
  const triggerIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const pose of position.poses) {
      for (const trigger of pose.triggers) {
        if (seen.has(trigger)) continue;
        seen.add(trigger);
        ids.push(trigger);
      }
    }
    return ids;
  }, [position.poses]);

  // 렌더 중 시그널 읽기로 구독 형성 - 매핑에 없는 id(죽은 레인)는 구독하지 않는다
  const pressedIds = new Set<string>();
  for (const id of triggerIds) {
    const canonical = keyCanonicalMap.get(id);
    if (!canonical) continue;
    if (getKeySignal(canonical).value) pressedIds.add(id);
  }

  const target = resolveSpriteTarget(position, pressedIds);

  const { failedImageSrcs, markFailed } = useFailedImageSrcs(
    position.baseImage,
    ...position.poses.map((pose) => pose.imageOverride),
  );

  const baseImageSrc = resolveImageSource(position.baseImage);
  const targetImageSrc = resolveImageSource(target.imageSrc);

  // 실패한 src는 baseImage로 폴백, 그것도 실패면 렌더 제외
  let imageSrc = targetImageSrc;
  if (imageSrc && failedImageSrcs.has(imageSrc)) imageSrc = baseImageSrc;
  if (imageSrc && failedImageSrcs.has(imageSrc)) imageSrc = null;

  // 첫 자세 전환에서 cold decode가 겹치지 않도록 base와 모든 override를 선행 디코드
  const warmupSrcs = useMemo(() => {
    const srcs = new Set<string>();
    const base = resolveImageSource(position.baseImage);
    if (base) srcs.add(base);
    for (const pose of position.poses) {
      const src = resolveImageSource(pose.imageOverride);
      if (src) srcs.add(src);
    }
    return [...srcs];
  }, [position.baseImage, position.poses]);

  useEffect(() => {
    for (const src of warmupSrcs) warmupImageSource(src);
  }, [warmupSrcs]);

  if (position.hidden) return null;

  return (
    <div
      className={`absolute ${position.className || ''}`}
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${position.dx}px, ${position.dy}px, 0)`,
        width: `${position.width}px`,
        height: `${position.height}px`,
        zIndex: position.zIndex ?? 0,
        pointerEvents: 'none',
      }}
      data-sprite-element="true"
      data-state={pressedIds.size > 0 ? 'active' : 'idle'}
    >
      {imageSrc && (
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: `${position.imageRect.x}px`,
            top: `${position.imageRect.y}px`,
            width: `${position.imageRect.width}px`,
            height: `${position.imageRect.height}px`,
            objectFit: position.imageFit ?? 'contain',
            transformOrigin: `${position.pivot.x * 100}% ${
              position.pivot.y * 100
            }%`,
            transform: spriteTransformToCss(target.transform),
            transition: `transform ${position.transitionMs}ms ${position.transitionEasing}`,
            willChange: 'transform',
          }}
          onError={(event) => {
            if (!isErrorForCurrentSrc(event.currentTarget, imageSrc)) return;
            markFailed(imageSrc);
          }}
        />
      )}
    </div>
  );
});

export default OverlaySpriteItem;
