import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "@contexts/I18nContext";
import { useUIStore } from "@stores/useUIStore";
import FolderIcon from "@assets/svgs/folder.svg";
import SettingIcon from "@assets/svgs/setting.svg";
import CloseEyeIcon from "@assets/svgs/close_eye.svg";
import OpenEyeIcon from "@assets/svgs/open_eye.svg";
import ChevronDownIcon from "@assets/svgs/chevron-down.svg";
import TurnIcon from "@assets/svgs/turn_arrow.svg";
import FloatingTooltip from "../Modal/FloatingTooltip";
import ListPopup, { ListItem } from "../Modal/ListPopup";
import { TooltipGroup } from "../Modal/TooltipGroup";
import { useSettingsStore } from "@stores/useSettingsStore";

type SettingToolProps = {
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
  showAlert?: (message: string) => void;
  // onOpenNoteSetting?: () => void;
};

const SettingTool = ({
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  showAlert,
  // onOpenNoteSetting,
}: SettingToolProps) => {
  const { t } = useTranslation();
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [isExportImportOpenLocal, setIsExportImportOpenLocal] = useState(false);
  // const [isExtrasOpen, setIsExtrasOpenLocal] = useState(false);
  const exportImportRef = useRef<HTMLButtonElement | null>(null);
  // const extrasRef = useRef<HTMLButtonElement | null>(null);
  // const { noteEffect } = useSettingsStore();
  // const setExtrasPopupOpen = useUIStore((state) => state.setExtrasPopupOpen);
  const setExportImportPopupOpen = useUIStore(
    (state) => state.setExportImportPopupOpen
  );

  // isExportImportOpen 상태를 설정하면서 전역 스토어에도 동기화
  const setIsExportImportOpen = (
    value: boolean | ((prev: boolean) => boolean)
  ) => {
    setIsExportImportOpenLocal((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      setExportImportPopupOpen(newValue);
      return newValue;
    });
  };

  // 로컬 상태를 읽을 때는 isExportImportOpenLocal 사용
  const isExportImportOpen = isExportImportOpenLocal;

  // isExtrasOpen 상태를 설정하면서 전역 스토어에도 동기화
  // const setIsExtrasOpen = (value: boolean | ((prev: boolean) => boolean)) => {
  //   setIsExtrasOpenLocal((prev) => {
  //     const newValue = typeof value === "function" ? value(prev) : value;
  //     setExtrasPopupOpen(newValue);
  //     return newValue;
  //   });
  // };

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    window.api.overlay
      .get()
      .then((state) => {
        setIsOverlayVisible(state.visible);
      })
      .catch((error) => {
        console.error("Failed to fetch overlay visibility", error);
      });

    unsubscribe = window.api.overlay.onVisibility(({ visible }) => {
      setIsOverlayVisible(visible);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // const menuItems: ListItem[] = [
  //   { id: "note", label: t("tooltip.noteSettings"), disabled: !noteEffect },
  // ];

  const toggleOverlay = () => {
    const next = !isOverlayVisible;
    setIsOverlayVisible(next);
    window.api.overlay.setVisible(next).catch((error) => {
      console.error("Failed to toggle overlay", error);
    });
  };

  const handlePresetSave = async () => {
    try {
      const result = await window.api.presets.save();
      showAlert?.(
        result?.success ? t("preset.saveSuccess") : t("preset.saveFail")
      );
    } catch (error) {
      console.error("Failed to save preset", error);
      showAlert?.(t("preset.saveFail"));
    }
  };

  const handlePresetLoad = async () => {
    try {
      const result = await window.api.presets.load();
      showAlert?.(
        result?.success ? t("preset.loadSuccess") : t("preset.loadFail")
      );
    } catch (error) {
      console.error("Failed to load preset", error);
      showAlert?.(t("preset.loadFail"));
    }
  };

  return (
    <div className="flex gap-[10px]">
      {!isSettingsOpen && (
        <TooltipGroup>
          <div className="flex items-center h-[40px] p-[5px] bg-button-primary rounded-[7px] gap-[0px]">
            <FloatingTooltip content={t("tooltip.exportPreset")}>
              <Button icon={<FolderIcon />} onClick={handlePresetSave} />
            </FloatingTooltip>

            <FloatingTooltip
              content={t("tooltip.importExport")}
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
                  { id: "import", label: t("preset.import") },
                  { id: "export", label: t("preset.export") },
                ]}
                onSelect={async (id) => {
                  if (id === "import") {
                    await handlePresetLoad();
                  } else if (id === "export") {
                    await handlePresetSave();
                  }
                  setIsExportImportOpen(false);
                }}
              />
            </div>
          </div>
        </TooltipGroup>
      )}
      <TooltipGroup>
        <div className="flex items-center h-[40px] p-[5px] bg-button-primary rounded-[7px] gap-[5px]">
          <FloatingTooltip
            content={
              isOverlayVisible
                ? t("tooltip.overlayClose")
                : t("tooltip.overlayOpen")
            }
          >
            <Button
              icon={isOverlayVisible ? <CloseEyeIcon /> : <OpenEyeIcon />}
              onClick={toggleOverlay}
            />
          </FloatingTooltip>
          <div className="flex items-center">
            <FloatingTooltip
              content={
                isSettingsOpen ? t("tooltip.back") : t("tooltip.settings")
              }
            >
              <Button
                icon={isSettingsOpen ? <TurnIcon /> : <SettingIcon />}
                onClick={isSettingsOpen ? onCloseSettings : onOpenSettings}
              />
            </FloatingTooltip>
            {/* 기타 설정 extras 영역 주석처리 */}
            {/*
            <>
              <FloatingTooltip
                content={t("tooltip.etcSettings")}
                disabled={isExtrasOpen}
              >
                <ChevronButton
                  ref={extrasRef}
                  isSelected={isExtrasOpen}
                  onClick={() => setIsExtrasOpen((prev) => !prev)}
                />
              </FloatingTooltip>
              <div className="relative">
                <ListPopup
                  open={isExtrasOpen}
                  referenceRef={extrasRef}
                  onClose={() => setIsExtrasOpen(false)}
                  items={menuItems}
                  onSelect={(id) => {
                    if (id === "note") {
                      onOpenNoteSetting?.();
                    }
                  }}
                  offsetX={-10}
                />
              </div>
            </>
            */}
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
      className={`flex items-center justify-center h-[30px] w-[30px] rounded-[7px] transition-colors active:bg-button-active ${
        isSelected
          ? "bg-button-active"
          : "bg-button-primary hover:bg-button-hover"
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
        className={`flex items-center justify-center h-[30px] w-[14px] rounded-[7px] transition-colors active:bg-button-active ${
          isSelected
            ? "bg-button-active hover:bg-button-active"
            : "bg-button-primary hover:bg-button-hover"
        }`}
        onClick={onClick}
      >
        <ChevronDownIcon />
      </button>
    );
  }
);

export default SettingTool;
