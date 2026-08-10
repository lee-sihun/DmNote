import React from 'react';

// 기존 아이콘은 트랙과 노브가 하나의 외곽선으로 합쳐져 있어 노브만 따로 움직일 수 없다.
// rect + circle로 다시 그린 것이라 실루엣은 원본과 동일.
// 진폭이 서로 다른 건 의도 - 세 노브가 같은 거리만큼 움직이면 한 덩어리로 보인다
const KNOBS = [
  { cx: 2.5, cy: 4.6875, ride: '2.6px' },
  { cx: 7.5, cy: 10.3125, ride: '-2.8px' },
  { cx: 12.5, cy: 5.625, ride: '2.2px' },
];

// 트랙 설정 아이콘 — 세 노브가 시차를 두고 움직여 잠깐 머물렀다 돌아온다.
// 모션은 main.css의 dmnIconRide
const FaderIcon = () => {
  return (
    <svg
      data-dmn-icon
      width="14"
      height="14"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
    >
      {KNOBS.map(({ cx }) => (
        <rect
          key={cx}
          x={cx - 1}
          y="0"
          width="2"
          height="15"
          rx="1"
          fill="currentColor"
        />
      ))}
      {KNOBS.map(({ cx, cy, ride }, index) => (
        <circle
          key={cx}
          data-dmn-icon-motion="ride"
          style={
            {
              '--dmn-icon-ride': ride,
              '--dmn-icon-delay': `calc(var(--ui-icon-stagger) * ${index})`,
            } as React.CSSProperties
          }
          cx={cx}
          cy={cy}
          r="2.5"
          fill="currentColor"
        />
      ))}
    </svg>
  );
};

export default FaderIcon;
