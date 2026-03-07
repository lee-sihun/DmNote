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

const TabSwitch = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}: TabSwitchProps) => (
  <div
    className={`flex w-full h-[30px] bg-[#26262C] rounded-[7px] items-center p-[3px] gap-[5px] ${
      className ?? ''
    }`}
  >
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onTabChange(tab.id)}
        className={`w-full h-[24px] rounded-[7px] text-style-2 transition-colors ${
          activeTab === tab.id
            ? 'bg-[#3A3943] text-white'
            : 'bg-[#26262C] text-[#9395A1] hover:bg-[#303036]'
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export default TabSwitch;
