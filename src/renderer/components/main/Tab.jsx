import React, { useState, useEffect } from "react";
import { ReactComponent as Setting } from "@assets/svgs/setting.svg";
import SettingTab from "./SettingTab";
import Canvas from "./Canvas";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function Tab() {
  const [activeTab, setActiveTab] = useState(1);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const overlayLocked = useSettingsStore((state) => state.overlayLocked);
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    ipcRenderer.invoke("get-overlay-visibility").then((visible) => {
      setIsOverlayVisible(visible);
    });

    // 오버레이 상태 변경 이벤트 리스너
    const handleVisibilityChange = (_, visible) => {
      setIsOverlayVisible(visible);
    };

    ipcRenderer.on("overlay-visibility-changed", handleVisibilityChange);

    return () => {
      ipcRenderer.removeListener(
        "overlay-visibility-changed",
        handleVisibilityChange
      );
    };
  }, []);

  // overlayLocked 상태가 변경될 때마다 visibility 상태 동기화
  useEffect(() => {
    if (isOverlayVisible) {
      ipcRenderer.send("toggle-overlay", true);
    }
  }, [overlayLocked]);

  const toggleOverlay = () => {
    const newState = !isOverlayVisible;
    setIsOverlayVisible(newState);
    ipcRenderer.send("toggle-overlay", newState);
  };

  const tabs = [
    { id: 0, icon: <Setting />, label: null },
    { id: 1, label: "레이아웃" },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 0:
        return <SettingTab />;
      case 1:
        return <Canvas />;
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
          <div className="flex flex-col items-center justify-between h-full">
            <button
              onClick={toggleOverlay}
              className={`text-[13.5px] leading-[17px] font-normal hover:text-white transition-colors duration-150 text-[#989BA6]`}
            >
              {isOverlayVisible ? "오버레이 닫기" : "오버레이 열기"}
            </button>
            <div
              className={`w-[18px] h-[3px] rounded-t-[6px] bg-transparent`}
            />
          </div>
        </div>
      </div>
      <div className="flex h-full">{renderTabContent()}</div>
    </div>
  );
}

function Button({ children, isActive, onClick }) {
  return (
    <div className="flex flex-col items-center justify-between h-full">
      <button
        onClick={onClick}
        className={`text-[13.5px] leading-[17px] font-normal hover:text-white transition-colors duration-150 ${
          isActive ? "text-white" : "text-[#989BA6]"
        }`}
      >
        {children}
      </button>
      <div
        className={`w-[18px] h-[3px] rounded-t-[6px] ${
          isActive ? "bg-[#FFB400]" : "bg-transparent"
        }`}
      />
    </div>
  );
}
