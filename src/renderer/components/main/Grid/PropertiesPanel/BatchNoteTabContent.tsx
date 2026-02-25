import React from "react";
import type { KeyPosition } from "@src/types/keys";
import { PropertyRow, NumberInput, OptionalNumberInput, SectionDivider } from "./index";
import Checkbox from "@components/main/common/Checkbox";
import { NOTE_SETTINGS_CONSTRAINTS } from "@src/types/noteSettingsConstraints";
import { useSettingsStore } from "@stores/useSettingsStore";

interface BatchNoteTabContentProps {
  // getMixedValue 함수
  getMixedValue: <T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ) => { isMixed: boolean; value: T };
  // 핸들러
  handleBatchStyleChangeComplete: (property: keyof KeyPosition, value: any) => void;
  // 노트/글로우 색상 디스플레이
  getBatchNoteColorDisplay: () => {
    style: React.CSSProperties;
    label: string;
    isMixed: boolean;
  };
  getBatchGlowColorDisplay: () => {
    style: React.CSSProperties;
    label: string;
    isMixed: boolean;
  };
  // 컬러 피커 토글
  onNoteColorPickerToggle: () => void;
  onGlowColorPickerToggle: () => void;
  isNoteColorPickerOpen: boolean;
  isGlowColorPickerOpen: boolean;
  batchNoteColorButtonRef: React.RefObject<HTMLButtonElement>;
  batchGlowColorButtonRef: React.RefObject<HTMLButtonElement>;
  // 트랙 설정 모달 열기
  onOpenNoteSetting?: () => void;
  // 번역
  t: (key: string) => string;
}

const BatchNoteTabContent: React.FC<BatchNoteTabContentProps> = ({
  getMixedValue,
  handleBatchStyleChangeComplete,
  getBatchNoteColorDisplay,
  getBatchGlowColorDisplay,
  onNoteColorPickerToggle,
  onGlowColorPickerToggle,
  isNoteColorPickerOpen,
  isGlowColorPickerOpen,
  batchNoteColorButtonRef,
  batchGlowColorButtonRef,
  onOpenNoteSetting,
  t,
}) => {
  const { noteEffect } = useSettingsStore();

  const noteWidthMixed = getMixedValue((pos) => pos.noteWidth, undefined as any);

  return (
    <>
      {/* 트랙 설정 버튼 */}
      <button
        type="button"
        onClick={onOpenNoteSetting}
        disabled={!noteEffect || !onOpenNoteSetting}
        className={`w-full h-[28px] flex items-center justify-center rounded-[7px] text-style-2 transition-colors ${
          noteEffect && onOpenNoteSetting
            ? "bg-[#2A2A30] hover:bg-[#32323A] border border-[#3A3943] text-[#DBDEE8] cursor-pointer"
            : "bg-[#2A2A30] border border-[#3A3943] text-[#6B6D75] opacity-50 cursor-not-allowed"
        }`}
      >
        {t("tooltip.trackSettings") || "노트 트랙 설정"}
      </button>

      <SectionDivider />

      {/* 노트 효과 표시 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">
          {t("keySetting.noteEffectEnabled") || "노트 효과 표시"}
        </p>
        <Checkbox
          checked={
            getMixedValue((pos) => pos.noteEffectEnabled, true).value
          }
          onChange={() => {
            const currentValue = getMixedValue(
              (pos) => pos.noteEffectEnabled,
              true,
            ).value;
            handleBatchStyleChangeComplete("noteEffectEnabled", !currentValue);
          }}
        />
      </div>

      {/* Y축 자동 보정 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">
          {t("keySetting.noteAutoYCorrection") || "Y축 자동 보정"}
        </p>
        <Checkbox
          checked={
            getMixedValue((pos) => pos.noteAutoYCorrection, true).value
          }
          onChange={() => {
            const currentValue = getMixedValue(
              (pos) => pos.noteAutoYCorrection,
              true,
            ).value;
            handleBatchStyleChangeComplete("noteAutoYCorrection", !currentValue);
          }}
        />
      </div>

      <SectionDivider />

      {/* 노트 넓이 */}
      <PropertyRow label={t("keySetting.noteWidth") || "노트 넓이"}>
        {noteWidthMixed.isMixed ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <OptionalNumberInput
          value={noteWidthMixed.value}
          onChange={(value) => handleBatchStyleChangeComplete("noteWidth", value)}
          suffix="px"
          min={1}
          placeholder="Auto"
        />
      </PropertyRow>

      {/* 노트 색상 */}
      <PropertyRow label={t("keySetting.noteColor") || "노트 색상"}>
        <button
          ref={batchNoteColorButtonRef}
          onClick={onNoteColorPickerToggle}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            isNoteColorPickerOpen
              ? "border-[#459BF8]"
              : "border-[#3A3943] hover:border-[#505058]"
          }`}
          style={getBatchNoteColorDisplay().style}
          title={getBatchNoteColorDisplay().label}
          type="button"
        />
      </PropertyRow>

      {/* 노트 라운딩 */}
      <PropertyRow label={t("keySetting.noteBorderRadius") || "노트 라운딩"}>
        {getMixedValue(
          (pos) => pos.noteBorderRadius,
          NOTE_SETTINGS_CONSTRAINTS.borderRadius.default,
        ).isMixed ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <NumberInput
          value={
            getMixedValue(
              (pos) => pos.noteBorderRadius,
              NOTE_SETTINGS_CONSTRAINTS.borderRadius.default,
            ).value
          }
          onChange={(value) =>
            handleBatchStyleChangeComplete("noteBorderRadius", value)
          }
          suffix="px"
          min={NOTE_SETTINGS_CONSTRAINTS.borderRadius.min}
          max={NOTE_SETTINGS_CONSTRAINTS.borderRadius.max}
        />
      </PropertyRow>

      <SectionDivider />

      {/* 글로우 효과 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">
          {t("keySetting.noteGlow") || "글로우 효과"}
        </p>
        <Checkbox
          checked={
            getMixedValue((pos) => pos.noteGlowEnabled, false).value
          }
          onChange={() => {
            const currentValue = getMixedValue(
              (pos) => pos.noteGlowEnabled,
              false,
            ).value;
            handleBatchStyleChangeComplete("noteGlowEnabled", !currentValue);
          }}
        />
      </div>

      {/* 글로우 색상/크기/투명도 */}
      <PropertyRow label={t("keySetting.noteGlowColor") || "글로우 색상"}>
        <button
          ref={batchGlowColorButtonRef}
          onClick={onGlowColorPickerToggle}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            isGlowColorPickerOpen
              ? "border-[#459BF8]"
              : "border-[#3A3943] hover:border-[#505058]"
          }`}
          style={getBatchGlowColorDisplay().style}
          title={getBatchGlowColorDisplay().label}
          type="button"
        />
      </PropertyRow>

      <PropertyRow label={t("keySetting.noteGlowSize") || "글로우 크기"}>
        {getMixedValue((pos) => pos.noteGlowSize, 20).isMixed ? (
          <span className="text-[#6B6D75] text-style-4 italic">Mixed</span>
        ) : null}
        <NumberInput
          value={getMixedValue((pos) => pos.noteGlowSize, 20).value}
          onChange={(value) =>
            handleBatchStyleChangeComplete("noteGlowSize", value)
          }
          suffix="px"
          min={0}
          max={50}
        />
      </PropertyRow>

    </>
  );
};

export default BatchNoteTabContent;
