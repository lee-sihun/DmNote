import React, { useState } from "react";
import Checkbox from "@components/main/common/Checkbox";
import Dropdown from "@components/main/common/Dropdown";
import Modal from "../Modal";

export default function NoteSetting({ onClose, settings, onSave }) {
  const initial = settings || {};
  const [borderRadius, setBorderRadius] = useState(
    Number.isFinite(Number(initial.borderRadius))
      ? Number(initial.borderRadius)
      : 2
  );
  const [speed, setSpeed] = useState(
    Number.isFinite(Number(initial.speed)) ? Number(initial.speed) : 180
  );
  const [trackHeight, setTrackHeight] = useState(
    Number.isFinite(Number(initial.trackHeight))
      ? Number(initial.trackHeight)
      : 150
  );
  const [reverse, setReverse] = useState(Boolean(initial.reverse || false));
  const [fadePosition, setFadePosition] = useState(
    initial.fadePosition || "auto"
  );

  const fadeOptions = [
    { label: "자동", value: "auto" },
    { label: "상단", value: "top" },
    { label: "하단", value: "bottom" },
  ];

  const handleSave = async () => {
    const normalized = {
      borderRadius: Math.max(1, Math.min(parseInt(borderRadius || 1), 100)),
      speed: Math.max(70, Math.min(parseInt(speed || 70), 1000)),
      trackHeight: Math.min(Math.max(trackHeight, 50), 500),
      reverse,
      fadePosition,
    };
    try {
      await onSave?.(normalized);
      onClose?.();
    } catch (e) {
      onClose?.();
    }
  };

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] gap-[19px] border-[1px] border-[#2A2A30]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">라운딩</p>
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
            className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] text-style-4 text-[#DBDEE8]"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">속도</p>
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
            className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] text-style-4 text-[#DBDEE8]"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">트랙 높이</p>
          <input
            type="number"
            min={50}
            max={500}
            value={trackHeight}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                setTrackHeight("");
              } else {
                const num = parseInt(v);
                if (!Number.isNaN(num)) {
                  setTrackHeight(Math.min(Math.max(num, 50), 500));
                }
              }
            }}
            onBlur={(e) => {
              if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                setTrackHeight(150);
              } else {
                const num = parseInt(e.target.value);
                setTrackHeight(Math.min(Math.max(num, 50), 500));
              }
            }}
            className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] text-style-4 text-[#DBDEE8]"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">페이드 위치</p>
          <Dropdown
            options={fadeOptions}
            value={fadePosition}
            onChange={setFadePosition}
            placeholder="선택"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">리버스 효과</p>
          <Checkbox checked={reverse} onChange={() => setReverse(!reverse)} />
        </div>

        <div className="flex gap-[10.5px]">
          <button
            onClick={handleSave}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            저장
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            취소
          </button>
        </div>
      </div>
    </Modal>
  );
}
