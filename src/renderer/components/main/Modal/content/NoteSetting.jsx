import React, { useEffect, useState } from "react";
import Checkbox from "@components/main/common/Checkbox";
import Modal from "../Modal";

export default function NoteSetting({ onClose }) {
  const ipcRenderer = window.electron?.ipcRenderer;
  const [borderRadius, setBorderRadius] = useState(2);
  const [speed, setSpeed] = useState(180);
  const [trackHeight, setTrackHeight] = useState("150");
  const [reverse, setReverse] = useState(false);
  const [fadePosition, setFadePosition] = useState("auto");

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
          setTrackHeight(
            Number.isFinite(Number(settings.trackHeight))
              ? String(settings.trackHeight)
              : "150"
          );
          setReverse(Boolean(settings.reverse || false));
          setFadePosition(settings.fadePosition || "auto");
        }
      })
      .catch(() => {});
  }, [ipcRenderer]);

  const handleSave = async () => {
    if (!ipcRenderer) return onClose?.();
    const parsedTrack = parseInt(trackHeight);
    const clientTrack = Number.isFinite(parsedTrack)
      ? Math.min(Math.max(parsedTrack, 50), 500)
      : 150;

    const normalized = {
      borderRadius: Math.max(1, Math.min(parseInt(borderRadius || 1), 100)),
      speed: Math.max(70, Math.min(parseInt(speed || 70), 1000)),
      trackHeight: clientTrack,
      reverse: reverse,
      fadePosition: fadePosition,
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
    <Modal onClick={onClose}>
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
              min={1}
              max={100}
              value={borderRadius}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setBorderRadius("");
                } else {
                  const num = parseInt(v);
                  if (!Number.isNaN(num)) {
                    setBorderRadius(Math.min(Math.max(num, 1), 100));
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setBorderRadius(2);
                } else {
                  const num = parseInt(e.target.value);
                  setBorderRadius(Math.min(Math.max(num, 1), 100));
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
              min={70}
              max={1000}
              value={speed}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setSpeed("");
                } else {
                  const num = parseInt(v);
                  if (!Number.isNaN(num) && num >= 0) {
                    setSpeed(num);
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setSpeed(180);
                } else {
                  const num = parseInt(e.target.value);
                  setSpeed(Math.min(Math.max(num, 70), 1000));
                }
              }}
              className="text-center w-[60px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
            {/* <p className="text-[#989BA6] text-[13.5px] font-bold">px/s</p> */}
          </div>
        </div>

        <div className="flex justify-between w-full mt-[18px] items-center">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            트랙 높이
          </p>
          <div className="flex items-center gap-[10px]">
            <input
              type="number"
              min={50}
              max={500}
              value={trackHeight}
              onChange={(e) => {
                setTrackHeight(e.target.value);
              }}
              onBlur={(e) => {
                const v = e.target.value;
                if (v === "" || isNaN(parseInt(v))) {
                  setTrackHeight("150");
                } else {
                  const num = parseInt(v);
                  setTrackHeight(String(Math.min(Math.max(num, 50), 500)));
                }
              }}
              className="text-center w-[60px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
          </div>
        </div>

        <div className="flex justify-between w-full mt-[18px] items-center">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            페이드 위치
          </p>
          <div className="flex items-center gap-[10px]">
            <select
              value={fadePosition}
              onChange={(e) => setFadePosition(e.target.value)}
              className="bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[13px] pl-[8px] py-1 w-[60px]"
            >
              <option value="auto">자동</option>
              <option value="top">상단</option>
              <option value="bottom">하단</option>
            </select>
          </div>
        </div>

        <div className="flex justify-between w-full mt-[18px] items-center">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            노트 효과 리버스
          </p>
          <div className="mr-[16.5px]">
            <Checkbox checked={reverse} onChange={() => setReverse(!reverse)} />
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
    </Modal>
  );
}
