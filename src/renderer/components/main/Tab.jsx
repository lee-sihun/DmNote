import React, { useState, useEffect } from "react";
import { ReactComponent as Setting } from "@assets/svgs/setting.svg";
import SettingTab from "./SettingTab";
import Canvas from "./Canvas";
import CustomAlert from "@components/CustomAlert";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function Tab() {
  const [activeTab, setActiveTab] = useState(1);
  const overlayLocked = useSettingsStore((state) => state.overlayLocked);

  // CustomAlert 상태 관리
  const [alertState, setAlertState] = useState({
    isOpen: false,
    message: "",
    type: "alert",
    confirmText: "확인",
    onConfirm: null,
  });

  const showAlert = (message, confirmText = "확인") => {
    setAlertState({
      isOpen: true,
      message,
      type: "alert",
      confirmText,
      onConfirm: null,
    });
  };

  const showConfirm = (message, onConfirmCallback, confirmText = "확인") => {
    setAlertState({
      isOpen: true,
      message,
      type: "confirm",
      confirmText,
      onConfirm: onConfirmCallback,
    });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: "",
      type: "alert",
      confirmText: "확인",
      onConfirm: null,
    });
  };

  const handleConfirm = () => {
    if (alertState.onConfirm) {
      alertState.onConfirm();
    }
    closeAlert();
  };

  useEffect(() => {}, []);

  const tabs = [
    { id: 0, icon: <Setting />, label: null },
    { id: 1, label: "레이아웃" },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 0:
        return <SettingTab showAlert={showAlert} showConfirm={showConfirm} />;
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
            <div
              className={`w-[18px] h-[3px] rounded-t-[6px] bg-transparent`}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {renderTabContent()}
      </div>

      <CustomAlert
        isOpen={alertState.isOpen}
        message={alertState.message}
        type={alertState.type}
        confirmText={alertState.confirmText}
        onConfirm={handleConfirm}
        onCancel={closeAlert}
      />
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
