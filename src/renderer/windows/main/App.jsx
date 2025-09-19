import React, { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import TitleBar from "@components/main/TitleBar";
import { useCustomCssInjection } from "@hooks/useCustomCssInjection";
import ToolBar from "@components/main/tool/ToolBar";
import Grid from "@components/main/Grid";
import SettingTab from "@components/main/Settings";
import { useKeyManager } from "@hooks/useKeyManager";
import { usePalette } from "@hooks/usePalette";
import CustomAlert from "@components/main/modal/content/Alert";
import NoteSettingModal from "@components/main/modal/content/NoteSetting";
import { useSettingsStore } from "@stores/useSettingsStore";
import FloatingPopup from "@components/main/modal/FloatingPopup";
import Palette from "@components/main/modal/content/Palette";

export default function App() {
  useCustomCssInjection();

  const primaryButtonRef = useRef(null);

  const {
    selectedKey,
    setSelectedKey,
    keyMappings,
    positions,
    handlePositionChange,
    handleKeyUpdate,
    handleAddKey,
    handleDeleteKey,
    handleResetCurrentMode,
  } = useKeyManager();
  const { color, palette, setPalette, handleColorChange, handlePaletteClose } =
    usePalette();

  const [activeTool, setActiveTool] = useState("move");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNoteSettingOpen, setIsNoteSettingOpen] = useState(false);
  const [skipModalAnimationOnReturn, setSkipModalAnimationOnReturn] = useState(false);
  const [noteSettings, setNoteSettings] = useState(null);
  const {
    noteEffect,
    angleMode,
    setAngleMode,
    language: storeLanguage,
    setLanguage,
  } = useSettingsStore();
  const confirmCallbackRef = useRef(null);
  const [alertState, setAlertState] = useState({
    isOpen: false,
    message: "",
    confirmText: "확인",
    type: "alert",
  });
  const { t } = useTranslation();

  useEffect(() => {
    const ipcRenderer = window.electron?.ipcRenderer;
    if (!ipcRenderer) return;

    ipcRenderer
      .invoke("get-note-settings")
      .then((settings) => {
        setNoteSettings(settings);
      })
      .catch(() => {});

    ipcRenderer.send("get-hardware-acceleration");
    ipcRenderer.send("get-always-on-top");
    ipcRenderer.send("get-overlay-lock");
    ipcRenderer.send("get-note-effect");

    ipcRenderer.invoke("get-angle-mode").then((mode) => {
      if (mode && mode !== angleMode) {
        setAngleMode(mode);
      }
    });
    ipcRenderer.invoke("get-use-custom-css").then((enabled) => {});
    ipcRenderer.invoke("get-custom-css").then((data) => {});
    ipcRenderer.invoke("get-overlay-resize-anchor").then((val) => {});
    ipcRenderer.invoke("get-language").then((lng) => {
      if (lng && lng !== storeLanguage) {
        setLanguage(lng);
      }
    });

    const languageUpdateHandler = (_, lng) => {
      if (lng && lng !== storeLanguage) setLanguage(lng);
    };
    ipcRenderer.on("update-language", languageUpdateHandler);

    return () => {
      ipcRenderer.removeListener("update-language", languageUpdateHandler);
    };
  }, []);

  const showAlert = (message) =>
    setAlertState({
      isOpen: true,
      message,
      type: "alert",
      confirmText: t("common.confirm"),
    });

  const showConfirm = (
    message,
    onConfirm,
    confirmText = t("common.confirm")
  ) => {
    confirmCallbackRef.current =
      typeof onConfirm === "function" ? onConfirm : null;
    setAlertState({ isOpen: true, message, confirmText, type: "confirm" });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: "",
      confirmText: t("common.confirm"),
      type: "alert",
    });
    confirmCallbackRef.current = null;
  };

  return (
    <div className="bg-[#111012] w-full h-full flex flex-col overflow-hidden rounded-[7px] border border-[rgba(255,255,255,0.1)]">
      <TitleBar />
      <div className="flex-1 bg-[#2A2A31] overflow-hidden">
        {isSettingsOpen ? (
          <div className="h-full overflow-y-auto">
            <SettingTab
              showAlert={(m) =>
                setAlertState({
                  isOpen: true,
                  message: m,
                  type: "alert",
                  confirmText: "확인",
                })
              }
              showConfirm={showConfirm}
            />
          </div>
        ) : (
          <Grid
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            keyMappings={keyMappings}
            positions={positions}
            onPositionChange={handlePositionChange}
            onKeyUpdate={handleKeyUpdate}
            onKeyDelete={handleDeleteKey}
            color={color}
            activeTool={activeTool}
            showConfirm={showConfirm}
            shouldSkipModalAnimation={skipModalAnimationOnReturn}
            onModalAnimationConsumed={() => setSkipModalAnimationOnReturn(false)}
          />
        )}
      </div>
      <ToolBar
        onAddKey={handleAddKey}
        onTogglePalette={() => setPalette((p) => !p)}
        isPaletteOpen={palette}
        onResetCurrentMode={() =>
          showConfirm(
            t("confirm.resetCurrentTab"),
            handleResetCurrentMode,
            t("confirm.reset")
          )
        }
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        isSettingsOpen={isSettingsOpen}
        onOpenSettings={() => {
          if (selectedKey) setSkipModalAnimationOnReturn(true);
          setIsSettingsOpen(true);
        }}
        onCloseSettings={() => setIsSettingsOpen(false)}
        showAlert={showAlert}
        onOpenNoteSetting={() => setIsNoteSettingOpen(true)}
        primaryButtonRef={primaryButtonRef}
      />
      {palette && (
        <FloatingPopup
          open={palette}
          referenceRef={primaryButtonRef}
          placement="top"
          offset={25}
          onClose={handlePaletteClose}
          className="z-50"
        >
          <Palette color={color} onColorChange={handleColorChange} />
        </FloatingPopup>
      )}
      {noteEffect && isNoteSettingOpen && noteSettings && (
        <NoteSettingModal
          settings={noteSettings}
          onClose={() => setIsNoteSettingOpen(false)}
          onSave={async (normalized) => {
            const ipcRenderer = window.electron?.ipcRenderer;
            if (ipcRenderer) {
              try {
                const ok = await ipcRenderer.invoke(
                  "update-note-settings",
                  normalized
                );
                if (ok) {
                  setNoteSettings(normalized);
                }
              } catch (e) {}
            }
          }}
        />
      )}
      <CustomAlert
        isOpen={alertState.isOpen}
        message={alertState.message}
        type={alertState.type}
        confirmText={alertState.confirmText}
        onConfirm={() => {
          if (alertState.type === "confirm" && confirmCallbackRef.current) {
            const cb = confirmCallbackRef.current;
            confirmCallbackRef.current = null;
            try {
              cb();
            } catch (_) {}
          }
          closeAlert();
        }}
        onCancel={() => {
          confirmCallbackRef.current = null;
          closeAlert();
        }}
      />
    </div>
  );
}
