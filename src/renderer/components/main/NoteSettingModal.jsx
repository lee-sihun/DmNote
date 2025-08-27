import React, { useEffect, useState } from "react";

export default function NoteSettingModal({ onClose }) {
  const ipcRenderer = window.electron?.ipcRenderer;
  const [borderRadius, setBorderRadius] = useState(2);
  const [speed, setSpeed] = useState(180);

  useEffect(() => {
    if (!ipcRenderer) return;
    ipcRenderer
      .invoke("get-note-settings")
      .then((settings) => {
        if (settings) {
          setBorderRadius(
            Number.isFinite(Number(settings.borderRadius))
              ? Number(settings.borderRadius)
              : 2
          );
          setSpeed(
            Number.isFinite(Number(settings.speed))
              ? Number(settings.speed)
              : 180
          );
        }
      })
      .catch(() => {});
  }, [ipcRenderer]);

  const handleSave = async () => {
    if (!ipcRenderer) return onClose?.();
    const normalized = {
      borderRadius: Math.max(0, Math.min(parseInt(borderRadius || 0), 100)),
      speed: Math.max(1, Math.min(parseInt(speed || 1), 2000)),
    };
    try {
      const ok = await ipcRenderer.invoke("update-note-settings", normalized);
      if (ok) {
        onClose?.();
      }
    } catch (e) {
      onClose?.();
    }
  };

  return (
    <div
      className="fixed top-[41px] left-[1px] flex items-center justify-center w-[896px] h-[451px] bg-[#000000] bg-opacity-[0.31] backdrop-blur-[37.5px] rounded-b-[6px]"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center justify-center w-[334.5px] p-[25px] bg-[#1C1E25] border border-[#3B4049] rounded-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between w-full mt-[18px] items-center">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            노트 라운딩
          </p>
          <div className="flex items-center gap-[10px]">
            <input
              type="number"
              value={borderRadius}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setBorderRadius("");
                } else {
                  const num = parseInt(v);
                  if (!Number.isNaN(num)) {
                    setBorderRadius(Math.min(Math.max(num, 0), 100));
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setBorderRadius(2);
                }
              }}
              className="text-center w-[60px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
            {/* <p className="text-[#989BA6] text-[13.5px] font-bold">px</p> */}
          </div>
        </div>

        <div className="flex justify-between w-full mt-[18px] items-center">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            노트 속도
          </p>
          <div className="flex items-center gap-[10px]">
            <input
              type="number"
              value={speed}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setSpeed("");
                } else {
                  const num = parseInt(v);
                  if (!Number.isNaN(num)) {
                    setSpeed(Math.min(Math.max(num, 1), 2000));
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setSpeed(180);
                }
              }}
              className="text-center w-[60px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
            {/* <p className="text-[#989BA6] text-[13.5px] font-bold">px/s</p> */}
          </div>
        </div>

        <div className="flex w-full justify-between h-[31.5px] mt-[30.25px] gap-[8px]">
          <button
            onClick={handleSave}
            className="flex-1 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
          >
            저장
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}