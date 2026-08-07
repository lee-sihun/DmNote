import React from 'react';
import { useOptimisticValueCommit } from '@hooks/useOptimisticValueCommit';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface TabItem {
  id: string;
  label: string;
}

interface TabSwitchProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  commitStrategy?: CommitStrategy;
  className?: string;
}

// 세그먼트 컨트롤 — 활성 인디케이터가 transform으로 슬라이딩
const TabSwitch = ({
  tabs,
  activeTab,
  onTabChange,
  commitStrategy = 'sync',
  className,
}: TabSwitchProps) => {
  const { value: visualActiveTab, select } = useOptimisticValueCommit({
    canonicalValue: activeTab,
    onCommit: onTabChange,
    strategy: commitStrategy,
  });
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === visualActiveTab),
  );

  return (
    <div
      className={`relative flex w-full h-[30px] bg-inset rounded-surface items-center p-[2px] ${
        className ?? ''
      }`}
    >
      <div
        aria-hidden
        className="absolute top-[2px] bottom-[2px] left-[2px] rounded-[8px] bg-fill-active shadow-elevation-chrome transition-transform duration-base ease-out-expo"
        style={{
          width: `calc((100% - 4px) / ${tabs.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={visualActiveTab === tab.id}
          data-tab-id={tab.id}
          onClick={() => select(tab.id)}
          className={`relative z-10 w-full h-full rounded-[8px] text-body transition-colors duration-base ${
            visualActiveTab === tab.id
              ? 'text-fg'
              : 'text-fg-muted hover:text-fg'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default TabSwitch;
