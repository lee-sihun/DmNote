import DuplicateGhostHost from './DuplicateGhostHost';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import SpriteImagePlaceholder from '@components/main/common/SpriteImagePlaceholder';
import { computeSpriteImageStyle } from '@utils/sprite/spriteImageStyles';
import {
  ACTIVITY_AREA_GUIDE_COLOR,
  activityAreaGuideMetrics,
} from '@utils/grid/activityAreaGuide';
import { DEFAULT_SPRITE_SIZE } from '@src/types/key/sprites';
import type { ReactiveSpritePosition } from '@src/types/key/sprites';

interface SpriteDuplicateGhostProps {
  position: ReactiveSpritePosition;
  /** 커서 위치 (그리드 좌표) - 고스트는 커서를 중심에 둔다 */
  cursor: { x: number; y: number };
  zoom: number;
}

// 복제 배치 미리보기. 이미지 원점 규칙을 SpriteItem과 똑같이 맞춘다 -
// 호스트에 보더를 두면 안쪽 이미지가 밀려 놓는 순간 위치가 튄다
const SpriteDuplicateGhost = ({
  position,
  cursor,
  zoom,
}: SpriteDuplicateGhostProps) => {
  const width = position.width || DEFAULT_SPRITE_SIZE;
  const height = position.height || DEFAULT_SPRITE_SIZE;
  const baseSrc = resolveImageSource(position.baseImage);
  // 이미지가 없거나 유실됐으면 아이템과 같은 자리표시자 - 놓는 순간 보일 것과 같게
  const { failedImageSrcs, markFailed } = useFailedImageSrcs(
    position.baseImage,
  );
  const ghostImage = baseSrc && !failedImageSrcs.has(baseSrc) ? baseSrc : null;

  return (
    <DuplicateGhostHost
      width={width}
      height={height}
      cursor={cursor}
      dataAttributes={{ 'data-sprite-ghost': 'true' }}
    >
      {ghostImage ? (
        <img
          src={ghostImage}
          alt=""
          draggable={false}
          style={{
            // 고스트는 CSS 변수 채널이 닿지 않아 인라인 강제
            ...computeSpriteImageStyle(
              { ...position, useInlineStyles: true },
              position.idleTransform,
            ),
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          onError={(event) => {
            if (!isErrorForCurrentSrc(event.currentTarget, ghostImage)) return;
            markFailed(ghostImage);
          }}
        />
      ) : (
        <SpriteImagePlaceholder />
      )}
      <div
        data-sprite-activity-guide="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderStyle: 'dashed',
          borderColor: ACTIVITY_AREA_GUIDE_COLOR,
          ...activityAreaGuideMetrics(zoom),
        }}
      />
    </DuplicateGhostHost>
  );
};

export default SpriteDuplicateGhost;
