import React, { useRef, useState, useEffect } from "react";
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
  const [noteSettings, setNoteSettings] = useState(null);
  const { noteEffect } = useSettingsStore();
  const confirmCallbackRef = useRef(null);
  const [alertState, setAlertState] = useState({
    isOpen: false,
    message: "",
    confirmText: "확인",
    type: "alert",
  });

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

    ipcRenderer.invoke("get-angle-mode").then((mode) => {});
    ipcRenderer.invoke("get-use-custom-css").then((enabled) => {});
    ipcRenderer.invoke("get-custom-css").then((data) => {});
    ipcRenderer.invoke("get-overlay-resize-anchor").then((val) => {});
  }, []);

  const showAlert = (message) =>
    setAlertState({
      isOpen: true,
      message,
      type: "alert",
      confirmText: "확인",
    });

  const showConfirm = (message, onConfirm, confirmText = "확인") => {
    confirmCallbackRef.current =
      typeof onConfirm === "function" ? onConfirm : null;
    setAlertState({ isOpen: true, message, confirmText, type: "confirm" });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: "",
      confirmText: "확인",
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
          />
        )}
      </div>
      <ToolBar
        onAddKey={handleAddKey}
        onTogglePalette={() => setPalette((p) => !p)}
        isPaletteOpen={palette}
        onResetCurrentMode={() =>
          showConfirm(
            "현재 탭의 설정을 초기화하시겠습니까?",
            handleResetCurrentMode,
            "초기화"
          )
        }
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        isSettingsOpen={isSettingsOpen}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
