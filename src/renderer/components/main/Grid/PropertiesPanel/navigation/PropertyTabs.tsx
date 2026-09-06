import React from 'react';
import type { TabsProps } from '../types';
import { TABS } from '../types';
import TabSwitch from '@components/main/common/TabSwitch';

// ============================================================================
// 탭 버튼 & 탭
// ============================================================================

export const Tabs: React.FC<TabsProps> = ({
  activeTab,
  onTabChange,
  t,
  availableTabs,
}) => {
  const tabs = availableTabs?.length
    ? availableTabs
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  const labels: Record<string, string> = {
    [TABS.STYLE]: t('propertiesPanel.tabStyle') || '키',
    [TABS.NOTE]: t('propertiesPanel.tabNote') || '노트',
    [TABS.COUNTER]: t('propertiesPanel.tabCounter') || '카운터',
  };

  return (
    <TabSwitch
      tabs={tabs.map((tab) => ({ id: tab, label: labels[tab] }))}
      activeTab={activeTab}
      onTabChange={onTabChange}
      commitStrategy="after-paint"
    />
  );
};

// ============================================================================
// 아이콘 컴포넌트
// ============================================================================

export const CloseIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M1 1L9 9M9 1L1 9"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

// 레이어/속성 모드 전환 토글 아이콘
export const ModeToggleIcon: React.FC<{
  mode: 'layer' | 'property';
  disabled?: boolean;
}> = ({ mode, disabled = false }) => {
  const strokeColor = 'currentColor';
  const fillColor = 'currentColor';
  const disabledClass = disabled ? 'text-fg-disabled' : undefined;

  if (mode === 'layer') {
    // 레이어 아이콘 (쌓인 레이어)
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className={disabledClass}
      >
        <path
          d="M8 2L14 5.5L8 9L2 5.5L8 2Z"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M2 8L8 11.5L14 8"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 10.5L8 14L14 10.5"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 속성 아이콘 (슬라이더/설정)
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={disabledClass}
    >
      <line
        x1="2"
        y1="4"
        x2="14"
        y2="4"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="5" cy="4" r="1.5" fill={fillColor} />
      <line
        x1="2"
        y1="8"
        x2="14"
        y2="8"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="11" cy="8" r="1.5" fill={fillColor} />
      <line
        x1="2"
        y1="12"
        x2="14"
        y2="12"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="7" cy="12" r="1.5" fill={fillColor} />
    </svg>
  );
};
