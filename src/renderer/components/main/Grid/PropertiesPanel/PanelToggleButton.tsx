import { usePressAction } from '@hooks/usePressAction';
import React, { useLayoutEffect, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { usePressGatedSwap } from '@hooks/usePressGatedSwap';

interface PanelToggleButtonProps {
  open: boolean;
  onClick: () => void;
}

// tokens.css의 --ui-duration-base / --ui-ease-out과 동기 (WAAPI는 CSS 변수 참조 불가)
const FADE_MS = 180;
const FADE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const CHIP_SHOWN = '1';
const CHIP_HIDDEN = '0';

// 패널 열기/닫기 토글 — 열림/닫힘을 하나의 지속 노드로 렌더해
// 리마운트 깜빡임 없이 글래스 칩 ↔ 베어 아이콘으로 모프.
// 아이콘 중심은 두 상태 모두 우상단 (24, 24) 앵커에 고정.
// 칩은 opacity 페이드 — backdrop-filter가 없는 재질이라 안전
// (블러+opacity 조합은 WKWebView에서 블러 레이어가 점멸).
// 눈 토글과 같은 규칙: FROM 상태를 정적으로 고정하고 TO 커밋은 onfinish에서
const PanelToggleButton = ({ open, onClick }: PanelToggleButtonProps) => {
  const { t } = useTranslation();
  // 버튼에 data-instant 부여 — 외부 개폐 시 divider/lines transition도 차단
  const { ref, isInstant } = usePressGatedSwap<HTMLButtonElement>(open);
  const chipRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(false);
  const animRef = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const chip = chipRef.current;
    if (!chip) return;

    // 칩은 opacity로만 움직임 — 잔류 인라인 transform 방어적 제거
    chip.style.transform = '';

    // 초기 마운트는 정적 상태 그대로 — 페이드 연출 없음
    const restState = open ? CHIP_HIDDEN : CHIP_SHOWN;
    if (!mountedRef.current) {
      mountedRef.current = true;
      chip.style.opacity = restState;
      return;
    }

    animRef.current?.cancel();
    animRef.current = null;

    // 직접 클릭이 아닌 외부 개폐는 페이드 없이 즉시 커밋
    if (
      isInstant() ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      chip.style.opacity = restState;
      return;
    }

    const from = open ? CHIP_SHOWN : CHIP_HIDDEN;
    chip.style.opacity = from;
    const anim = chip.animate([{ opacity: from }, { opacity: restState }], {
      duration: FADE_MS,
      easing: FADE_EASE,
    });
    anim.onfinish = () => {
      chip.style.opacity = restState;
    };
    animRef.current = anim;
  }, [open, isInstant]);

  const label = open
    ? t('propertiesPanel.closePanel') || '속성 패널 닫기'
    : t('propertiesPanel.openPanel') || '속성 패널 열기';

  // 설정 세션 중에는 cancel terminal action - 입력 blur와의 click 경합 방어
  const togglePress = usePressAction(() => onClick());

  return (
    <div className="absolute top-0 right-0 z-30 w-[48px] h-[48px] flex items-center justify-center pointer-events-none">
      <button
        ref={ref}
        {...togglePress}
        className="dmn-panel-toggle pointer-events-auto relative w-[32px] h-[32px] flex items-center justify-center text-white/45 hover:text-white/90 transition-colors"
        data-open={open ? 'true' : 'false'}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <span
          ref={chipRef}
          aria-hidden="true"
          className="absolute inset-0 rounded-[8px] bg-glass-panel shadow-elevation-chrome"
        />
        <svg
          className="relative"
          width="16"
          height="14"
          viewBox="0 0 16 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="14.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
          <line
            className="dmn-panel-toggle-divider"
            x1="10"
            y1="1"
            x2="10"
            y2="13"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <g
            className="dmn-panel-toggle-lines"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          >
            <line x1="12" y1="4" x2="13.5" y2="4" />
            <line x1="12" y1="7" x2="13.5" y2="7" />
            <line x1="12" y1="10" x2="13.5" y2="10" />
          </g>
        </svg>
      </button>
    </div>
  );
};

export default PanelToggleButton;
