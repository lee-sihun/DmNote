import React, { useState } from "react";
import Checkbox from "@components/main/common/Checkbox";
import Dropdown from "@components/main/common/Dropdown";
import Modal from "../Modal";
import { useTranslation } from "@contexts/I18nContext";
import {
  NOTE_SETTINGS_CONSTRAINTS,
  clampValue,
} from "../../../../../types/noteSettingsConstraints";

export default function NoteSetting({ onClose, settings, onSave }) {
  const { t } = useTranslation();
  const initial = settings || {};
  const [frameLimit, setFrameLimit] = useState(
    Number.isFinite(Number(initial.frameLimit))
      ? clampValue(Number(initial.frameLimit), "frameLimit")
      : NOTE_SETTINGS_CONSTRAINTS.frameLimit.default
  );
  const [speed, setSpeed] = useState(
    Number.isFinite(Number(initial.speed))
      ? Number(initial.speed)
      : NOTE_SETTINGS_CONSTRAINTS.speed.default
  );
  const [trackHeight, setTrackHeight] = useState(
    Number.isFinite(Number(initial.trackHeight))
      ? Number(initial.trackHeight)
      : NOTE_SETTINGS_CONSTRAINTS.trackHeight.default
  );
  const [reverse, setReverse] = useState(Boolean(initial.reverse || false));
  const [fadePosition, setFadePosition] = useState(
    initial.fadePosition || "auto"
  );

  const fadeOptions = [
    { label: t("noteSetting.auto"), value: "auto" },
    { label: t("noteSetting.top"), value: "top" },
    { label: t("noteSetting.bottom"), value: "bottom" },
    { label: t("noteSetting.none"), value: "none" },
  ];

  const handleSave = async () => {
    const parsedFrameLimit = parseInt(String(frameLimit), 10);
    const normalized = {
      ...settings,
      frameLimit:
        frameLimit === "" || Number.isNaN(parsedFrameLimit)
          ? NOTE_SETTINGS_CONSTRAINTS.frameLimit.default
          : clampValue(parsedFrameLimit, "frameLimit"),
      speed: clampValue(
        parseInt(speed || NOTE_SETTINGS_CONSTRAINTS.speed.default),
        "speed"
      ),
      trackHeight: clampValue(
        parseInt(trackHeight || NOTE_SETTINGS_CONSTRAINTS.trackHeight.default),
        "trackHeight"
      ),
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
          <p className="text-white text-style-2">{t("noteSetting.frameLimit")}</p>
          <input
            type="number"
            min={NOTE_SETTINGS_CONSTRAINTS.frameLimit.min}
            max={NOTE_SETTINGS_CONSTRAINTS.frameLimit.max}
            value={frameLimit}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                setFrameLimit("");
              } else {
                const num = parseInt(v, 10);
                if (!Number.isNaN(num) && num >= 0) {
                  setFrameLimit(num);
                }
              }
            }}
            onBlur={(e) => {
              const parsed = parseInt(e.target.value, 10);
              if (e.target.value === "" || Number.isNaN(parsed)) {
                setFrameLimit(NOTE_SETTINGS_CONSTRAINTS.frameLimit.default);
              } else {
                setFrameLimit(clampValue(parsed, "frameLimit"));
              }
            }}
            className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t("noteSetting.speed")}</p>
          <input
            type="number"
            min={NOTE_SETTINGS_CONSTRAINTS.speed.min}
            max={NOTE_SETTINGS_CONSTRAINTS.speed.max}
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
                setSpeed(NOTE_SETTINGS_CONSTRAINTS.speed.default);
              } else {
                const num = parseInt(e.target.value);
                setSpeed(clampValue(num, "speed"));
              }
            }}
            className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t("noteSetting.trackHeight")}
          </p>
          <input
            type="number"
            min={NOTE_SETTINGS_CONSTRAINTS.trackHeight.min}
            max={NOTE_SETTINGS_CONSTRAINTS.trackHeight.max}
            value={trackHeight}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                setTrackHeight("");
              } else {
                const num = parseInt(v);
                if (!Number.isNaN(num) && num >= 0) {
                  setTrackHeight(num);
                }
              }
            }}
            onBlur={(e) => {
              if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                setTrackHeight(NOTE_SETTINGS_CONSTRAINTS.trackHeight.default);
              } else {
                const num = parseInt(e.target.value);
                setTrackHeight(clampValue(num, "trackHeight"));
              }
            }}
            className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t("noteSetting.fadePosition")}
          </p>
          <Dropdown
            options={fadeOptions}
            value={fadePosition}
            onChange={setFadePosition}
            placeholder={t("noteSetting.select")}
          />
        </div>

        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t("noteSetting.reverseEffect")}
          </p>
          <Checkbox checked={reverse} onChange={() => setReverse(!reverse)} />
        </div>

        <div className="flex gap-[10.5px]">
          <button
            onClick={handleSave}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t("noteSetting.save")}
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            {t("noteSetting.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
