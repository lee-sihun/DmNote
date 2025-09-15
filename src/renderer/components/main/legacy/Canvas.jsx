import React, { useState, useRef } from "react";
import Grid from "./Grid";
import { useKeyStore } from "@stores/useKeyStore";
import { useSettingsStore } from "@stores/useSettingsStore";
import CustomAlert from "@components/CustomAlert";
import NoteSettingModal from "./NoteSettingModal";

export default function Canvas() {
  const [alertState, setAlertState] = useState({
    isOpen: false,
    message: "",
    confirmText: "확인",
    type: "alert",
  });
  const confirmCallbackRef = useRef(null);
  const { noteEffect } = useSettingsStore();

  const showAlert = (message, confirmText = "확인") => {
    setAlertState({
      isOpen: true,
      message,
      confirmText,
      type: "alert",
    });
  };

  const showConfirm = (message, onConfirm, confirmText = "확인") => {
    confirmCallbackRef.current =
      typeof onConfirm === "function" ? onConfirm : null;
    setAlertState({
      isOpen: true,
      message,
      confirmText,
      type: "confirm",
    });
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

  const [isNoteSettingOpen, setIsNoteSettingOpen] = useState(false);

  return (
    <div className="flex flex-col w-full h-full p-[18px] justify-between">
      <div className="flex justify-between">
        <KeyMenu />
        <SaveMenu
          showAlert={showAlert}
          onOpenNoteSetting={() => setIsNoteSettingOpen(true)}
        />
      </div>
      <Grid showAlert={showAlert} showConfirm={showConfirm} />

      {noteEffect && isNoteSettingOpen && (
        <NoteSettingModal onClose={() => setIsNoteSettingOpen(false)} />
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

export function KeyMenu() {
  const { selectedKeyType, setSelectedKeyType } = useKeyStore();

  const keyTypes = ["4key", "5key", "6key", "8key"];

  return (
    <div className="flex gap-[14px] ">
      {keyTypes.map((keyType) => (
        <button
          key={keyType}
          onClick={() => setSelectedKeyType(keyType)}
          className={`
            flex justify-center items-center w-[45px] h-[31.5px] rounded-[6px] 
            ${
              selectedKeyType !== keyType
                ? "bg-[#14161B] text-[#414249] border-none"
                : "bg-[#272B33] text-[#989BA6] border-[rgba(255,255,255,0.1)]"
            }
            border text-[15px] font-semibold
          `}
        >
          {keyType.replace("key", "B")}
        </button>
      ))}
    </div>
  );
}

export function SaveMenu({ showAlert, onOpenNoteSetting }) {
  const ipcRenderer = window.electron.ipcRenderer;
  const { noteEffect } = useSettingsStore();

  const handleSavePreset = async () => {
    const success = await ipcRenderer.invoke("save-preset");
    if (success) {
      showAlert("프리셋이 저장되었습니다.");
    } else {
      showAlert("프리셋 저장에 실패했습니다.");
    }
  };

  const handleLoadPreset = async () => {
    const success = await ipcRenderer.invoke("load-preset");
    if (success) {
      showAlert("프리셋이 로드되었습니다.");
    } else {
      showAlert("프리셋 로드에 실패했습니다.");
    }
  };

  return (
    <div className="flex gap-[13.5px]">
      {noteEffect && (
        <button
          onClick={onOpenNoteSetting}
          className="flex items-center h-[31.5px] px-[16px] rounded-[6px] bg-[#272B33] border border-[rgba(255,255,255,0.1)] text-[15px] font-normal text-center text-white"
        >
          노트 설정
        </button>
      )}
      <button
        onClick={handleLoadPreset}
        className="flex items-center h-[31.5px] px-[16px] rounded-[6px] bg-[#272B33] border border-[rgba(255,255,255,0.1)] text-[15px] font-normal text-center text-white"
      >
        프리셋 불러오기
      </button>
      <button
        onClick={handleSavePreset}
        className="flex items-center h-[31.5px] px-[16px] rounded-[6px] bg-[#272B33] border border-[rgba(255,255,255,0.1)] text-[15px] font-normal text-center text-white"
      >
        프리셋 내보내기
      </button>
    </div>
  );
}
