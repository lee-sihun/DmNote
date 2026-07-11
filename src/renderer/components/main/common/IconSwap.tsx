import React from 'react';

interface IconSwapProps {
  active: boolean;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
}

// 상태 토글 버튼의 아이콘 크로스페이드 — 두 아이콘을 겹쳐두고 CSS로 스왑
// 스타일은 main.css의 .dmn-icon-swap, 다이얼은 tokens.css의 --ui-icon-swap-*
const IconSwap = ({ active, activeIcon, inactiveIcon }: IconSwapProps) => (
  <span
    className="dmn-icon-swap"
    data-state={active ? 'on' : 'off'}
    aria-hidden="true"
  >
    <span data-icon="on">{activeIcon}</span>
    <span data-icon="off">{inactiveIcon}</span>
  </span>
);

export default IconSwap;
