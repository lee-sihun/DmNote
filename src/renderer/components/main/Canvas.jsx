import React from "react";
import Grid from "./Grid";
import { useKeyStore } from "@stores/useKeyStore";

export default function Canvas() {
  return (
    <div className="flex flex-col w-full h-full p-[18px] justify-between">
      <div className="flex justify-between">
        <KeyMenu />
        <SaveMenu />
      </div>
      <Grid />
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
            border text-[15px] font-bold
          `}
        >
          {keyType.replace("key", "키")}
        </button>
      ))}
    </div>
  );
}

export function SaveMenu() {
  const ipcRenderer = window.electron.ipcRenderer;

  const handleSavePreset = async () => {
    const success = await ipcRenderer.invoke("save-preset");
    if (success) {
      alert("프리셋이 저장되었습니다.");
    } else {
      alert("프리셋 저장에 실패했습니다.");
    }
  };

  const handleLoadPreset = async () => {
    const success = await ipcRenderer.invoke("load-preset");
    if (success) {
      alert("프리셋이 로드되었습니다.");
    } else {
      alert("프리셋 로드에 실패했습니다.");
    }
  };

  return (
    <div className="flex gap-[13.5px]">
      <button
        onClick={handleLoadPreset}
        className="flex items-center h-[31.5px] px-[16px] rounded-[6px] bg-[#272B33] border border-[rgba(255,255,255,0.1)] text-[15px] font-medium text-center text-white"
      >
        프리셋 불러오기
      </button>
      <button
        onClick={handleSavePreset}
        className="flex items-center h-[31.5px] px-[16px] rounded-[6px] bg-[#272B33] border border-[rgba(255,255,255,0.1)] text-[15px] font-medium text-center text-white"
      >
        프리셋 내보내기
      </button>
    </div>
  );
}
