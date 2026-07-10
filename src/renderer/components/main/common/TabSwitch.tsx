import React from 'react';

interface TabItem {
  id: string;
  label: string;
}

interface TabSwitchProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

// 세그먼트 컨트롤 — 활성 인디케이터가 transform으로 슬라이딩
const TabSwitch = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}: TabSwitchProps) => {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTab),
  );

  return (
    <div
      className={`relative flex w-full h-[30px] bg-inset rounded-lg items-center p-[2px] ${
        className ?? ''
      }`}
    >
      <div
        aria-hidden
        className="absolute top-[2px] bottom-[2px] left-[2px] rounded-[6px] bg-surface-active shadow-elevation-1 transition-transform duration-base ease-out-expo"
        style={{
          width: `calc((100% - 4px) / ${tabs.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={`relative z-10 w-full h-full rounded-[6px] text-body transition-colors duration-base ${
            activeTab === tab.id ? 'text-fg' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default TabSwitch;
