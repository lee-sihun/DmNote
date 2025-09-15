import React, { useEffect, useRef, useState } from "react";
import { ReactComponent as FolderIcon } from "@assets/svgs/folder.svg";
import { ReactComponent as SettingIcon } from "@assets/svgs/setting.svg";
import { ReactComponent as CloseEyeIcon } from "@assets/svgs/close_eye.svg";
import { ReactComponent as OpenEyeIcon } from "@assets/svgs/open_eye.svg";
import { ReactComponent as ChevronDownIcon } from "@assets/svgs/chevron-down.svg";
import { ReactComponent as TurnIcon } from "@assets/svgs/turn_arrow.svg";
import FloatingTooltip from "../modal/FloatingTooltip";
import ListPopup, { ListItem } from "../modal/ListPopup";
import { TooltipGroup } from "../modal/TooltipGroup";
import { useSettingsStore } from "@stores/useSettingsStore";

type SettingToolProps = {
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
  showAlert?: (message: string) => void;
  onOpenNoteSetting?: () => void;
};

const SettingTool = ({
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  showAlert,
  onOpenNoteSetting,
}: SettingToolProps) => {
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [isNoteSettingsOpen, setIsNoteSettingsOpen] = useState(false);
  const [isExportImportOpen, setIsExportImportOpen] = useState(false);
  const noteSettingsRef = useRef<HTMLButtonElement | null>(null);
  const exportImportRef = useRef<HTMLButtonElement | null>(null);
  const { noteEffect } = useSettingsStore();

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
        <TooltipGroup>
          <div className="flex items-center h-[40px] p-[5px] bg-[#0E0E11] rounded-[7px] gap-[0px]">
            <FloatingTooltip content="프리셋 내보내기">
              <Button
                icon={<FolderIcon />}
                onClick={async () => {
                  try {
                    const ok = await window.electron.ipcRenderer.invoke(
                      "save-preset"
                    );
                    if (showAlert) {
                      showAlert(
                        ok
                          ? "프리셋이 저장되었습니다."
                          : "프리셋 저장에 실패했습니다."
                      );
                    }
                  } catch {
                    showAlert?.("프리셋 저장에 실패했습니다.");
                  }
                }}
              />
            </FloatingTooltip>

            <FloatingTooltip
              content="불러오기/내보내기"
              disabled={isExportImportOpen}
            >
              <ChevronButton
                ref={exportImportRef}
                isSelected={isExportImportOpen}
                onClick={() => setIsExportImportOpen((prev) => !prev)}
              />
            </FloatingTooltip>
            <div className="relative">
              <ListPopup
                open={isExportImportOpen}
                referenceRef={exportImportRef}
                onClose={() => setIsExportImportOpen(false)}
                items={[
                  { id: "import", label: "불러오기" },
                  { id: "export", label: "내보내기" },
                ]}
                onSelect={async (id) => {
                  try {
                    if (id === "import") {
                      const ok = await window.electron.ipcRenderer.invoke(
                        "load-preset"
                      );
                      showAlert?.(
                        ok
                          ? "프리셋이 로드되었습니다."
                          : "프리셋 로드에 실패했습니다."
                      );
                    } else if (id === "export") {
                      const ok = await window.electron.ipcRenderer.invoke(
                        "save-preset"
                      );
                      showAlert?.(
                        ok
                          ? "프리셋이 저장되었습니다."
                          : "프리셋 저장에 실패했습니다."
                      );
                    }
                  } catch {
                    if (id === "import") {
                      showAlert?.("프리셋 로드에 실패했습니다.");
                    } else if (id === "export") {
                      showAlert?.("프리셋 저장에 실패했습니다.");
                    }
                  }
                }}
              />
            </div>
          </div>
        </TooltipGroup>
      )}
      <TooltipGroup>
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
            {noteEffect && (
              <>
                <FloatingTooltip
                  content="기타 설정"
                  disabled={isNoteSettingsOpen}
                >
                  <ChevronButton
                    ref={noteSettingsRef}
                    isSelected={isNoteSettingsOpen}
                    onClick={() => setIsNoteSettingsOpen((prev) => !prev)}
                  />
                </FloatingTooltip>
                <div className="relative">
                  <ListPopup
                    open={isNoteSettingsOpen}
                    referenceRef={noteSettingsRef}
                    onClose={() => setIsNoteSettingsOpen(false)}
                    items={[{ id: "note", label: "노트 설정" }]}
                    onSelect={(id) => {
                      if (id === "note") {
                        onOpenNoteSetting?.();
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </TooltipGroup>
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

const ChevronButton = React.forwardRef<HTMLButtonElement, ChevronButtonProps>(
  ({ isSelected = false, onClick }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`flex items-center justify-center h-[30px] w-[14px] rounded-[7px] transition-colors active:bg-[#2A2A31] ${
          isSelected
            ? "bg-[#2A2A31] hover:bg-[#2A2A31]"
            : "bg-[#0E0E11] hover:bg-[#1E1E22]"
        }`}
        onClick={onClick}
      >
        <ChevronDownIcon />
      </button>
    );
  }
);

export default SettingTool;
