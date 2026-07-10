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

// 세그먼트 컨트롤
const TabSwitch = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}: TabSwitchProps) => (
  <div
    className={`flex w-full h-[30px] bg-inset rounded-lg items-center p-[2px] gap-[2px] ${
      className ?? ''
    }`}
  >
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onTabChange(tab.id)}
        className={`w-full h-full rounded-[6px] text-body transition-colors duration-fast ${
          activeTab === tab.id
            ? 'bg-surface-active text-fg shadow-elevation-1'
            : 'text-fg-muted hover:text-fg'
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export default TabSwitch;
