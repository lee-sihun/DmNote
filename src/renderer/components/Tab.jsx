import React, { useState } from "react";
import { ReactComponent as Setting } from "@assets/svgs/setting.svg";
import Canvas from "./Canvas";

export default function Tab() {
  const [activeTab, setActiveTab] = useState(1);

  const tabs = [
    { id: 0, icon: <Setting />, label: null },
    { id: 1, label: "레이아웃" },
    { id: 2, label: "오버레이 열기" }
  ];

  const renderTabContent = () => {
    switch(activeTab) {
      case 0:
        return <div>설정</div>;
      case 1:
        return <Canvas />;
      case 2:
        return <div>오버레이 설정</div>;
      default:
        return null;
    }
  };
  
  return (
    <div className="flex flex-col flex-1 w-full h-full">
      <div className="flex w-full h-[36px] bg-[#18191F]">
        <div className="flex items-center h-full gap-[20px] ml-[18px]">
          {tabs.map((tab) => (
            <Button 
              key={tab.id}
              isActive={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon || tab.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex h-full">
        {renderTabContent()}
      </div>
    </div>
  )
}

function Button({ children, isActive, onClick }) {
  return (
    <div className="flex flex-col items-center justify-between h-full">
      <button 
        onClick={onClick}
        className={`text-[13.5px] leading-[17px] font-medium hover:text-white transition-colors duration-150 ${isActive ? 'text-white' : 'text-[#989BA6]'}`}
      >
        {children}
      </button>
      <div className={`w-[18px] h-[3px] rounded-t-[6px] ${isActive ? 'bg-[#FFB400]' : 'bg-transparent'}`}/>
    </div>
  )
}