import React, { useEffect, useRef } from 'react';
import FlaskIcon from '@assets/svgs/flask.svg';
import { useTranslation } from '@contexts/useTranslation';
import { PREVIEW_CLIPS, PREVIEW_KEYS } from '@constants/settingsPreviewClips';
import { useResolvedTheme } from '@hooks/app/useResolvedTheme';

interface SettingsPreviewProps {
  /** 지금 가리키는 설정. 미리보기가 없는 항목이면 기본 화면으로 돌아간다 */
  hoveredKey: string | null;
}

/**
 * 영상을 전부 붙여두고 보이는 것만 바꾼다.
 * 가리킬 때마다 새로 마운트하면 로드와 디코드를 다시 해서 한 번 끊긴다.
 *
 * 다만 설정을 열기만 해도 아홉 개가 한꺼번에 로드되면 아무것도 안 가리킨
 * 방문에서 헛일이 된다. 처음 무엇이든 가리킬 때까지는 preload를 none으로 두고,
 * 그때 한 번만 전부 데운다. 이후 전환은 이미 준비된 것들 사이라 안 끊긴다.
 *
 * 가리킨 것 하나만 남기는 방식도 있지만, 다음에 어디로 갈지 알 수 없어
 * 남기지 않은 클립으로 갈 때마다 다시 로드가 걸린다. 그게 여기서 고친 문제다
 */
const SettingsPreview = ({
  hoveredKey,
}: SettingsPreviewProps): React.ReactElement => {
  const { t } = useTranslation();
  // 클립은 테마별로 한 벌씩 있다. 색만 다르고 구성·길이는 같다
  const theme = useResolvedTheme();
  const videosRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const activeKey = hoveredKey && PREVIEW_CLIPS[hoveredKey] ? hoveredKey : null;
  const warmedRef = useRef(false);
  const themeRef = useRef(theme);

  useEffect(() => {
    // 테마가 바뀌면 아홉 개의 src가 통째로 갈린다 - 데워둔 것도 같이 무효다
    if (themeRef.current !== theme) {
      themeRef.current = theme;
      warmedRef.current = false;
    }
    // 처음 무엇이든 가리키는 순간 나머지도 받아둔다. 그 전까진 preload가 none이라
    // 설정만 열고 아무것도 안 가리킨 방문에서는 미리 받아두지 않는다.
    // none은 강제가 아니라 힌트라 브라우저가 조금 읽을 수는 있다.
    // 속성을 직접 바꾸므로 래치는 ref로 든다. 요소가 리마운트되면 둘 다 같이 초기화된다
    const warming = activeKey !== null && !warmedRef.current;
    if (warming) warmedRef.current = true;

    for (const key of PREVIEW_KEYS) {
      const video = videosRef.current[key];
      if (!video) continue;
      if (key === activeKey) {
        void video.play().catch(() => {});
        continue;
      }
      if (warming) {
        video.preload = 'auto';
        video.load();
      }
      // 숨길 때 미리 처음으로 돌려둔다. 보일 때 되감으면 직전 마지막
      // 프레임이 한 번 스치고, 그걸 가리려면 페이드를 넣어야 한다
      video.pause();
      if (video.currentTime !== 0) video.currentTime = 0;
    }
  }, [activeKey, theme]);

  return (
    <div className="relative w-full h-full">
      {PREVIEW_KEYS.map((key) => (
        <video
          key={key}
          ref={(el) => {
            videosRef.current[key] = el;
          }}
          src={PREVIEW_CLIPS[key].src[theme]}
          loop
          muted
          playsInline
          preload="none"
          className={
            'absolute inset-0 w-full h-full object-cover' +
            (key === activeKey ? '' : ' invisible')
          }
        />
      ))}
      {activeKey ? (
        <div className="absolute bottom-0 left-0 right-0 flex justify-center items-end h-[100px] bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
          <span className="mb-[16px] text-white text-title">
            {t(PREVIEW_CLIPS[activeKey].caption)}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <FlaskIcon className="text-fill" />
        </div>
      )}
    </div>
  );
};

export default SettingsPreview;
