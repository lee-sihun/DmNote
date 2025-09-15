import React, { useEffect, useState } from "react";
import { ReactComponent as FolderIcon } from "@assets/svgs/folder.svg";
import { ReactComponent as SettingIcon } from "@assets/svgs/setting.svg";
import { ReactComponent as CloseEyeIcon } from "@assets/svgs/close_eye.svg";
import { ReactComponent as OpenEyeIcon } from "@assets/svgs/open_eye.svg";
import { ReactComponent as ChevronDownIcon } from "@assets/svgs/chevron-down.svg";
import { ReactComponent as TurnIcon } from "@assets/svgs/turn_arrow.svg";
import FloatingTooltip from "../Modal/FloatingTooltip";

type SettingToolProps = {
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
};

const SettingTool = ({
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
}: SettingToolProps) => {
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);

  useEffect(() => {
    const ipc = window.electron.ipcRenderer;
    ipc.invoke("get-overlay-visibility").then((visible) => {
      setIsOverlayVisible(visible);
    });

    const handleVisibilityChange = (_, visible) => {
      setIsOverlayVisible(visible);
    };

    ipc.on("overlay-visibility-changed", handleVisibilityChange);

    return () => {
      ipc.removeListener("overlay-visibility-changed", handleVisibilityChange);
    };
  }, []);

  const toggleOverlay = () => {
    const newState = !isOverlayVisible;
    setIsOverlayVisible(newState);
    window.electron.ipcRenderer.send("toggle-overlay", newState);
  };

  return (
    <div className="flex gap-[10px]">
      {!isSettingsOpen && (
        <div className="flex items-center h-[40px] p-[5px] bg-[#0E0E11] rounded-[7px] gap-[0px]">
          <FloatingTooltip content="내보내기">
            <Button icon={<FolderIcon />} />
          </FloatingTooltip>
          <FloatingTooltip content="내보내기/불러오기">
            <ChevronButton />
          </FloatingTooltip>
        </div>
      )}
      <div className="flex items-center h-[40px] p-[5px] bg-[#0E0E11] rounded-[7px] gap-[5px]">
        <FloatingTooltip
          content={isOverlayVisible ? "오버레이 닫기" : "오버레이 열기"}
        >
          <Button
            icon={isOverlayVisible ? <CloseEyeIcon /> : <OpenEyeIcon />}
            onClick={toggleOverlay}
          />
        </FloatingTooltip>
        <div className="flex items-center">
          <FloatingTooltip content={isSettingsOpen ? "돌아가기" : "설정"}>
            <Button
              icon={isSettingsOpen ? <TurnIcon /> : <SettingIcon />}
              onClick={isSettingsOpen ? onCloseSettings : onOpenSettings}
            />
          </FloatingTooltip>
          <FloatingTooltip content="노트 설정">
            <ChevronButton />
          </FloatingTooltip>
        </div>
      </div>
    </div>
  );
};

interface ButtonProps {
  icon: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
}

const Button = ({ icon, isSelected = false, onClick }: ButtonProps) => {
  return (
    <button
      type="button"
      className={`flex items-center justify-center h-[30px] w-[30px] rounded-[7px] transition-colors active:bg-[#2A2A31] ${
        isSelected ? "bg-[#2A2A31]" : "bg-[#0E0E11] hover:bg-[#1E1E22]"
      }`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
};

interface ChevronButtonProps {
  isSelected?: boolean;
  onClick?: () => void;
}

const ChevronButton = ({ isSelected = false, onClick }: ChevronButtonProps) => {
  return (
    <button
      type="button"
      className={`flex items-center justify-center h-[30px] w-[14px] rounded-[7px] transition-colors active:bg-[#2A2A31] ${
        isSelected ? "bg-[#2A2A31]" : "bg-[#0E0E11] hover:bg-[#1E1E22]"
      }`}
      onClick={onClick}
    >
      <ChevronDownIcon />
    </button>
  );
};

export default SettingTool;
