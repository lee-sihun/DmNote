import React, { useId, useLayoutEffect, useRef } from 'react';

interface EyeToggleIconProps {
  slashed: boolean;
}

// tokens.css의 --ui-duration-base / --ui-ease-out과 동기 (WAAPI는 CSS 변수 참조 불가)
const SLIDE_MS = 180;
const SLIDE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// 사선 벡터 (16, 13)의 1.25배 — 갭 라인(굵기 4)의 round cap까지 뷰포트 밖으로
const SLASH_HIDDEN = 'translate(-20px, -16.25px)';
const SLASH_DRAWN = 'translate(0px, 0px)';
const SLASH_ERASED = 'translate(20px, 16.25px)';

// 표시/숨김 토글 눈 아이콘 — 눈은 고정하고 사선만 대각선 슬라이드로 그어짐/지워짐.
// 사선은 항상 전체 길이로 두고 자기 방향 벡터를 따라 평행이동 —
// 이동 경로가 사선과 동일 선상이라 드로우처럼 보이고, 뷰포트 밖은 SVG가 클리핑.
// 그릴 땐 좌상단 밖→제자리, 지울 땐 제자리→우하단 밖 (한 방향 관통 스와이프).
// 애니메이션 시작 전 FROM 상태를 정적으로 고정하고 TO 상태는 onfinish에서 커밋 —
// 시작이 한 프레임 늦어도 이전 모습이 유지될 뿐 깜빡임이 없음
const EyeToggleIcon = ({ slashed }: EyeToggleIconProps) => {
  const maskId = useId();
  const slashRef = useRef<SVGLineElement>(null);
  const gapRef = useRef<SVGLineElement>(null);
  const mountedRef = useRef(false);
  const animsRef = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const lines = [slashRef.current, gapRef.current].filter(
      (el): el is SVGLineElement => el !== null,
    );

    const applyStatic = (transform: string) => {
      lines.forEach((el) => {
        el.style.transform = transform;
      });
    };

    // 초기 마운트는 정적 상태 그대로 — 드로우 연출 없음
    if (!mountedRef.current) {
      mountedRef.current = true;
      applyStatic(slashed ? SLASH_DRAWN : SLASH_HIDDEN);
      return;
    }

    animsRef.current.forEach((anim) => anim.cancel());
    animsRef.current = [];

    const restState = slashed ? SLASH_DRAWN : SLASH_HIDDEN;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyStatic(restState);
      return;
    }

    const from = slashed ? SLASH_HIDDEN : SLASH_DRAWN;
    const to = slashed ? SLASH_DRAWN : SLASH_ERASED;
    applyStatic(from);
    lines.forEach((el) => {
      const anim = el.animate([{ transform: from }, { transform: to }], {
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
      });
      anim.onfinish = () => {
        el.style.transform = restState;
      };
      animsRef.current.push(anim);
    });
  }, [slashed]);

  return (
    <svg
      className="dmn-eye-toggle"
      width="18"
      height="14"
      viewBox="0 0 18 14"
      fill="none"
      aria-hidden="true"
    >
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="18"
        height="14"
      >
        <rect width="18" height="14" fill="white" />
        <line
          ref={gapRef}
          x1="1"
          y1="0.5"
          x2="17"
          y2="13.5"
          stroke="black"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </mask>
      <path
        mask={`url(#${maskId})`}
        d="M9.00002 0C6.47502 0 4.45315 1.15 2.98127 2.51875C1.51877 3.87812 0.540649 5.5 0.0750244 6.61562C-0.0281006 6.8625 -0.0281006 7.1375 0.0750244 7.38437C0.540649 8.5 1.51877 10.125 2.98127 11.4812C4.45315 12.8469 6.47502 14 9.00002 14C11.525 14 13.5469 12.85 15.0188 11.4812C16.4813 10.1219 17.4594 8.5 17.925 7.38437C18.0281 7.1375 18.0281 6.8625 17.925 6.61562C17.4594 5.5 16.4813 3.875 15.0188 2.51875C13.5469 1.15312 11.525 0 9.00002 0ZM4.50002 7C4.50002 5.80653 4.97413 4.66193 5.81804 3.81802C6.66196 2.97411 7.80655 2.5 9.00002 2.5C10.1935 2.5 11.3381 2.97411 12.182 3.81802C13.0259 4.66193 13.5 5.80653 13.5 7C13.5 8.19347 13.0259 9.33807 12.182 10.182C11.3381 11.0259 10.1935 11.5 9.00002 11.5C7.80655 11.5 6.66196 11.0259 5.81804 10.182C4.97413 9.33807 4.50002 8.19347 4.50002 7ZM9.00002 5C9.00002 6.10313 8.10315 7 7.00002 7C6.64065 7 6.30315 6.90625 6.0094 6.7375C5.97815 7.07812 6.00627 7.42812 6.10002 7.775C6.52815 9.375 8.17502 10.325 9.77502 9.89688C11.375 9.46875 12.325 7.82188 11.8969 6.22188C11.5156 4.79375 10.1625 3.88438 8.73752 4.00938C8.90315 4.3 9.00002 4.6375 9.00002 5Z"
        fill="currentColor"
      />
      <line
        ref={slashRef}
        x1="1"
        y1="0.5"
        x2="17"
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default EyeToggleIcon;
