import { resolveImageSource } from '@utils/core/imageSource';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import SpriteImagePlaceholder from '@components/main/common/SpriteImagePlaceholder';
import {
  DEFAULT_SPRITE_IMAGE_FIT,
  type SpriteImageFit,
} from '@src/types/key/sprites';

interface SpriteImagePreviewCardProps {
  // 저장된 경로 그대로 - 표시용 URL 변환은 카드가 맡는다
  source: string | null;
  imageFit: SpriteImageFit | null;
  onPick: () => void;
  onReset: () => void;
  t: (key: string) => string;
}

// 스프라이트 이미지 미리보기 - 전면 선택 버튼과 형제 초기화 버튼 (중첩 버튼 금지).
// 기본 이미지와 상태 이미지가 같은 문법을 쓴다
const SpriteImagePreviewCard = ({
  source,
  imageFit,
  onPick,
  onReset,
  t,
}: SpriteImagePreviewCardProps) => {
  const imageSrc = resolveImageSource(source);
  // 유실 이미지는 캔버스 아이템과 같은 자리표시자로 - 깨진 img를 두면 "미설정"과
  // 구분이 안 되는 빈 카드가 남는다. 초기화 칩은 저장값 기준이라 그대로 지울 수 있다
  const { failedImageSrcs, markFailed } = useFailedImageSrcs(source);
  const imageFailed = imageSrc !== null && failedImageSrcs.has(imageSrc);

  return (
    <div className="relative w-full h-[76px] rounded-[8px] overflow-hidden group">
      {/* 투명 격자 배경 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'var(--ui-checker-pattern) center / var(--ui-checker-size) var(--ui-checker-size) repeat',
        }}
      />
      {imageFailed ? (
        <SpriteImagePlaceholder color="var(--ui-fg-faint)" />
      ) : imageSrc ? (
        <img
          key={imageSrc}
          src={imageSrc}
          alt=""
          draggable={false}
          className="absolute inset-0 block w-full h-full pointer-events-none select-none"
          style={{ objectFit: imageFit ?? DEFAULT_SPRITE_IMAGE_FIT }}
          onError={(event) => {
            if (!isErrorForCurrentSrc(event.currentTarget, imageSrc)) return;
            markFailed(imageSrc);
          }}
        />
      ) : null}
      <button
        type="button"
        aria-label={t('propertiesPanel.spriteImageSelect') || '선택'}
        onClick={onPick}
        className="absolute inset-0 bg-black opacity-0 hover:opacity-40 focus-visible:opacity-40 transition-opacity cursor-pointer"
      />
      {/* 초기화는 그림이 아니라 저장값 기준 - 공백 경로처럼 그릴 수 없는 값도
          지울 수 있어야 한다. 칩이 그 값의 유일한 표시다 (이미지 피커와 같은 기준) */}
      {source ? (
        <button
          type="button"
          aria-label={t('imagePicker.reset') || '초기화'}
          title={t('imagePicker.reset') || '초기화'}
          onClick={onReset}
          // 18px 칩에 라이브 블러는 보이지도 않는다 - 솔리드 토큰 사용 (이미지 피커와 동일)
          className="absolute top-[4px] right-[4px] z-10 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] bg-glass-dim-solid shadow-elevation-chrome text-fg-faint hover:text-fg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-fast"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path
              d="M1 1L7 7M7 1L1 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
};

export default SpriteImagePreviewCard;
