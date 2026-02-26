import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteTabContentProps } from "./types";
import type { NoteColor, KeyPosition } from "@src/types/keys";
import {
  PropertyRow,
  NumberInput,
  OptionalNumberInput,
  SectionDivider,
} from "./PropertyInputs";
import Checkbox from "@components/main/common/Checkbox";
import ColorPicker from "@components/main/Modal/content/ColorPicker";
import { isGradientColor } from "@utils/colorUtils";
import { NOTE_SETTINGS_CONSTRAINTS } from "@src/types/noteSettingsConstraints";
import { useSettingsStore } from "@stores/useSettingsStore";

const DEFAULT_NOTE_COLOR = "#FFFFFF";

// 색상 모드 상수
const COLOR_MODES = {
  solid: "solid",
  gradient: "gradient",
} as const;

type ColorMode = (typeof COLOR_MODES)[keyof typeof COLOR_MODES];

// 그라디언트 객체 생성 헬퍼
const toGradient = (top: string, bottom: string) => ({
  type: "gradient" as const,
  top,
  bottom,
});

const NoteTabContent: React.FC<NoteTabContentProps> = ({
  keyIndex,
  keyPosition,
  onKeyUpdate,
  onKeyPreview,
  panelElement,
  t,
}) => {
  const { noteEffect } = useSettingsStore();

  // 통합 피커 상태 (카운터 탭 패턴)
  type PickerTarget = "note" | "glow" | null;
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  const pickerOpen = !!pickerFor;
  
  // 컬러 버튼 refs
  const noteColorButtonRef = useRef<HTMLButtonElement>(null);
  const glowColorButtonRef = useRef<HTMLButtonElement>(null);

  // 노트 색상 상태 (원본 모달과 동일한 패턴)
  const [noteColorMode, setNoteColorMode] = useState<ColorMode>(() => {
    const noteColor = keyPosition.noteColor;
    return isGradientColor(noteColor) ? COLOR_MODES.gradient : COLOR_MODES.solid;
  });
  const [noteColorTop, setNoteColorTop] = useState<string>(() => {
    const noteColor = keyPosition.noteColor;
    if (noteColor && typeof noteColor === "object" && noteColor.type === "gradient") {
      return noteColor.top;
    }
    return typeof noteColor === "string" ? noteColor : DEFAULT_NOTE_COLOR;
  });
  const [noteGradientBottom, setNoteGradientBottom] = useState<string>(() => {
    const noteColor = keyPosition.noteColor;
    if (noteColor && typeof noteColor === "object" && noteColor.type === "gradient") {
      return noteColor.bottom;
    }
    return typeof noteColor === "string" ? noteColor : DEFAULT_NOTE_COLOR;
  });

  // 글로우 색상 상태 (원본 모달과 동일한 패턴)
  const [glowColorMode, setGlowColorMode] = useState<ColorMode>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    return isGradientColor(glowColor) ? COLOR_MODES.gradient : COLOR_MODES.solid;
  });
  const [glowColorTop, setGlowColorTop] = useState<string>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    if (glowColor && typeof glowColor === "object" && glowColor.type === "gradient") {
      return glowColor.top;
    }
    return typeof glowColor === "string" ? glowColor : DEFAULT_NOTE_COLOR;
  });
  const [glowGradientBottom, setGlowGradientBottom] = useState<string>(() => {
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    if (glowColor && typeof glowColor === "object" && glowColor.type === "gradient") {
      return glowColor.bottom;
    }
    return typeof glowColor === "string" ? glowColor : DEFAULT_NOTE_COLOR;
  });

  const [localNoteOpacity, setLocalNoteOpacity] = useState<number>(() =>
    typeof keyPosition.noteOpacity === "number" ? keyPosition.noteOpacity : 80
  );
  const [localNoteOpacityTop, setLocalNoteOpacityTop] = useState<number>(() => {
    const base = typeof keyPosition.noteOpacity === "number" ? keyPosition.noteOpacity : 80;
    return typeof keyPosition.noteOpacityTop === "number" ? keyPosition.noteOpacityTop : base;
  });
  const [localNoteOpacityBottom, setLocalNoteOpacityBottom] = useState<number>(() => {
    const base = typeof keyPosition.noteOpacity === "number" ? keyPosition.noteOpacity : 80;
    return typeof keyPosition.noteOpacityBottom === "number"
      ? keyPosition.noteOpacityBottom
      : base;
  });
  const [localGlowOpacity, setLocalGlowOpacity] = useState<number>(() =>
    typeof keyPosition.noteGlowOpacity === "number"
      ? keyPosition.noteGlowOpacity
      : 70
  );
  const [localGlowOpacityTop, setLocalGlowOpacityTop] = useState<number>(() => {
    const base =
      typeof keyPosition.noteGlowOpacity === "number" ? keyPosition.noteGlowOpacity : 70;
    return typeof keyPosition.noteGlowOpacityTop === "number"
      ? keyPosition.noteGlowOpacityTop
      : base;
  });
  const [localGlowOpacityBottom, setLocalGlowOpacityBottom] = useState<number>(() => {
    const base =
      typeof keyPosition.noteGlowOpacity === "number" ? keyPosition.noteGlowOpacity : 70;
    return typeof keyPosition.noteGlowOpacityBottom === "number"
      ? keyPosition.noteGlowOpacityBottom
      : base;
  });

  // keyPosition 변경 시 내부 상태 동기화 (피커가 닫혀있을 때만)
  useEffect(() => {
    // 피커가 열려있으면 외부 변경을 무시 (드래그 중 충돌 방지)
    if (pickerFor === "note") return;
    
    const noteColor = keyPosition.noteColor;
    if (noteColor && typeof noteColor === "object" && noteColor.type === "gradient") {
      setNoteColorMode(COLOR_MODES.gradient);
      setNoteColorTop(noteColor.top);
      setNoteGradientBottom(noteColor.bottom);
    } else {
      setNoteColorMode(COLOR_MODES.solid);
      const color = typeof noteColor === "string" ? noteColor : DEFAULT_NOTE_COLOR;
      setNoteColorTop(color);
      setNoteGradientBottom(color);
    }
  }, [keyPosition.noteColor, pickerFor]);

  useEffect(() => {
    // 피커가 열려있으면 외부 변경을 무시 (드래그 중 충돌 방지)
    if (pickerFor === "glow") return;
    
    const glowColor = keyPosition.noteGlowColor ?? keyPosition.noteColor;
    if (glowColor && typeof glowColor === "object" && glowColor.type === "gradient") {
      setGlowColorMode(COLOR_MODES.gradient);
      setGlowColorTop(glowColor.top);
      setGlowGradientBottom(glowColor.bottom);
    } else {
      setGlowColorMode(COLOR_MODES.solid);
      const color = typeof glowColor === "string" ? glowColor : DEFAULT_NOTE_COLOR;
      setGlowColorTop(color);
      setGlowGradientBottom(color);
    }
  }, [keyPosition.noteGlowColor, keyPosition.noteColor, pickerFor]);

  useEffect(() => {
    if (pickerFor === "note") return;
    const base = typeof keyPosition.noteOpacity === "number" ? keyPosition.noteOpacity : 80;
    setLocalNoteOpacity(base);
    setLocalNoteOpacityTop(
      typeof keyPosition.noteOpacityTop === "number" ? keyPosition.noteOpacityTop : base
    );
    setLocalNoteOpacityBottom(
      typeof keyPosition.noteOpacityBottom === "number" ? keyPosition.noteOpacityBottom : base
    );
  }, [keyPosition.noteOpacity, keyPosition.noteOpacityTop, keyPosition.noteOpacityBottom, pickerFor]);

  useEffect(() => {
    if (pickerFor === "glow") return;
    const base =
      typeof keyPosition.noteGlowOpacity === "number" ? keyPosition.noteGlowOpacity : 70;
    setLocalGlowOpacity(base);
    setLocalGlowOpacityTop(
      typeof keyPosition.noteGlowOpacityTop === "number"
        ? keyPosition.noteGlowOpacityTop
        : base
    );
    setLocalGlowOpacityBottom(
      typeof keyPosition.noteGlowOpacityBottom === "number"
        ? keyPosition.noteGlowOpacityBottom
        : base
    );
  }, [
    keyPosition.noteGlowOpacity,
    keyPosition.noteGlowOpacityTop,
    keyPosition.noteGlowOpacityBottom,
    pickerFor,
  ]);

  const interactiveRefs = useMemo(
    () => [noteColorButtonRef, glowColorButtonRef],
    []
  );

  // 노트 색상 헬퍼 함수 (내부 상태 기반으로 실시간 반영)
  const getNoteColorDisplay = useCallback(() => {
    if (noteColorMode === COLOR_MODES.gradient) {
      return {
        style: { background: `linear-gradient(to bottom, ${noteColorTop}, ${noteGradientBottom})` },
        label: "Gradient",
      };
    }
    return {
      style: { backgroundColor: noteColorTop },
      label: noteColorTop.replace(/^#/, ""),
    };
  }, [noteColorMode, noteColorTop, noteGradientBottom]);

  const getGlowColorDisplay = useCallback(() => {
    if (glowColorMode === COLOR_MODES.gradient) {
      return {
        style: { background: `linear-gradient(to bottom, ${glowColorTop}, ${glowGradientBottom})` },
        label: "Gradient",
      };
    }
    return {
      style: { backgroundColor: glowColorTop },
      label: glowColorTop.replace(/^#/, ""),
    };
  }, [glowColorMode, glowColorTop, glowGradientBottom]);

  // 통합 색상 변경 핸들러 (pickerFor 기반)
  const handleColorChange = useCallback(
    (target: "note" | "glow", newColor: any) => {
      if (target === "note") {
        if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
          setNoteColorMode(COLOR_MODES.gradient);
          setNoteColorTop(newColor.top);
          setNoteGradientBottom(newColor.bottom);
        } else {
          setNoteColorMode(COLOR_MODES.solid);
          setNoteColorTop(newColor);
          setNoteGradientBottom(newColor);
        }
      } else {
        if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
          setGlowColorMode(COLOR_MODES.gradient);
          setGlowColorTop(newColor.top);
          setGlowGradientBottom(newColor.bottom);
        } else {
          setGlowColorMode(COLOR_MODES.solid);
          setGlowColorTop(newColor);
          setGlowGradientBottom(newColor);
        }
      }
    },
    []
  );

  const handleColorChangeComplete = useCallback(
    (target: "note" | "glow", newColor: any) => {
      let colorValue: NoteColor;
      
      if (target === "note") {
        if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
          setNoteColorMode(COLOR_MODES.gradient);
          setNoteColorTop(newColor.top);
          setNoteGradientBottom(newColor.bottom);
          colorValue = { type: "gradient", top: newColor.top, bottom: newColor.bottom };
        } else {
          setNoteColorMode(COLOR_MODES.solid);
          setNoteColorTop(newColor);
          setNoteGradientBottom(newColor);
          colorValue = newColor;
        }
        onKeyPreview?.(keyIndex, { noteColor: colorValue });
        onKeyUpdate({ index: keyIndex, noteColor: colorValue });
      } else {
        if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
          setGlowColorMode(COLOR_MODES.gradient);
          setGlowColorTop(newColor.top);
          setGlowGradientBottom(newColor.bottom);
          colorValue = { type: "gradient", top: newColor.top, bottom: newColor.bottom };
        } else {
          setGlowColorMode(COLOR_MODES.solid);
          setGlowColorTop(newColor);
          setGlowGradientBottom(newColor);
          colorValue = newColor;
        }
        onKeyPreview?.(keyIndex, { noteGlowColor: colorValue });
        onKeyUpdate({ index: keyIndex, noteGlowColor: colorValue });
      }
    },
    [keyIndex, onKeyPreview, onKeyUpdate]
  );

  // ColorPicker에 전달할 색상 (내부 상태 기반)
  const notePickerColor = useMemo(() => {
    if (noteColorMode === COLOR_MODES.gradient) {
      return toGradient(noteColorTop, noteGradientBottom);
    }
    return noteColorTop;
  }, [noteColorMode, noteColorTop, noteGradientBottom]);

  const glowPickerColor = useMemo(() => {
    if (glowColorMode === COLOR_MODES.gradient) {
      return toGradient(glowColorTop, glowGradientBottom);
    }
    return glowColorTop;
  }, [glowColorMode, glowColorTop, glowGradientBottom]);

  // 피커 토글 (같은 타겟이면 닫고, 다른 타겟이면 바로 전환)
  const handlePickerToggle = useCallback((target: "note" | "glow") => {
    setPickerFor((prev) => (prev === target ? null : target));
  }, []);

  // 스타일 변경 완료 핸들러
  const handleStyleChangeComplete = useCallback(
    (property: keyof KeyPosition, value: any) => {
      onKeyUpdate({ index: keyIndex, [property]: value });
    },
    [keyIndex, onKeyUpdate]
  );

  return (
    <>
      {/* 노트 효과 표시 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">{t("keySetting.noteEffectEnabled") || "노트 효과 표시"}</p>
        <Checkbox
          checked={keyPosition.noteEffectEnabled ?? true}
          onChange={() => handleStyleChangeComplete("noteEffectEnabled", !(keyPosition.noteEffectEnabled ?? true))}
        />
      </div>

      {/* Y축 자동 보정 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">{t("keySetting.noteAutoYCorrection") || "Y축 자동 보정"}</p>
        <Checkbox
          checked={keyPosition.noteAutoYCorrection ?? true}
          onChange={() => handleStyleChangeComplete("noteAutoYCorrection", !(keyPosition.noteAutoYCorrection ?? true))}
        />
      </div>

      <SectionDivider />

      {/* 노트 넓이 */}
      <PropertyRow label={t("keySetting.noteWidth") || "노트 넓이"}>
        <OptionalNumberInput
          value={keyPosition.noteWidth}
          onChange={(value) => handleStyleChangeComplete("noteWidth", value)}
          suffix="px"
          min={1}
          placeholder={`${Math.round(keyPosition.width)}px`}
        />
      </PropertyRow>

      {/* 노트 색상 */}
      <PropertyRow label={t("keySetting.noteColor") || "노트 색상"}>
        <button
          ref={noteColorButtonRef}
          type="button"
          onClick={() => handlePickerToggle("note")}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            pickerFor === "note"
              ? "border-[#459BF8]"
              : "border-[#3A3943] hover:border-[#505058]"
          }`}
          style={getNoteColorDisplay().style}
        />
      </PropertyRow>

      {/* 노트 라운딩 */}
      <PropertyRow label={t("keySetting.noteBorderRadius") || "노트 라운딩"}>
        <NumberInput
          value={
            keyPosition.noteBorderRadius ??
            NOTE_SETTINGS_CONSTRAINTS.borderRadius.default
          }
          onChange={(value) =>
            handleStyleChangeComplete("noteBorderRadius", value)
          }
          suffix="px"
          min={NOTE_SETTINGS_CONSTRAINTS.borderRadius.min}
          max={NOTE_SETTINGS_CONSTRAINTS.borderRadius.max}
        />
      </PropertyRow>

      <SectionDivider />

      {/* 글로우 효과 */}
      <div className="flex justify-between items-center w-full h-[23px]">
        <p className="text-white text-style-2">{t("keySetting.noteGlow") || "글로우 효과"}</p>
        <Checkbox
          checked={keyPosition.noteGlowEnabled ?? false}
          onChange={() => handleStyleChangeComplete("noteGlowEnabled", !(keyPosition.noteGlowEnabled ?? false))}
        />
      </div>

      {/* 글로우 색상/크기/투명도 */}
      <PropertyRow label={t("keySetting.noteGlowColor") || "글로우 색상"}>
        <button
          ref={glowColorButtonRef}
          type="button"
          onClick={() => handlePickerToggle("glow")}
          className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
            pickerFor === "glow"
              ? "border-[#459BF8]"
              : "border-[#3A3943] hover:border-[#505058]"
          }`}
          style={getGlowColorDisplay().style}
        />
      </PropertyRow>

      <PropertyRow label={t("keySetting.noteGlowSize") || "글로우 크기"}>
        <NumberInput
          value={keyPosition.noteGlowSize ?? 20}
          onChange={(value) => handleStyleChangeComplete("noteGlowSize", value)}
          suffix="px"
          min={0}
          max={50}
        />
      </PropertyRow>

      {/* 통합 ColorPicker - 단일 인스턴스로 깜빡임 없이 전환 */}
      {pickerFor && (
        <ColorPicker
          open={pickerOpen}
          referenceRef={pickerFor === "note" ? noteColorButtonRef : glowColorButtonRef}
          panelElement={panelElement}
          color={pickerFor === "note" ? notePickerColor : glowPickerColor}
          onColorChange={(c: any) => handleColorChange(pickerFor, c)}
          onColorChangeComplete={(c: any) => handleColorChangeComplete(pickerFor, c)}
          onClose={() => setPickerFor(null)}
          interactiveRefs={interactiveRefs}
          solidOnly={false}
          opacityPercent={
            pickerFor === "note"
              ? noteColorMode === COLOR_MODES.gradient
                ? { top: localNoteOpacityTop, bottom: localNoteOpacityBottom }
                : localNoteOpacity
              : glowColorMode === COLOR_MODES.gradient
              ? { top: localGlowOpacityTop, bottom: localGlowOpacityBottom }
              : localGlowOpacity
          }
          onOpacityPercentChange={(value: number, target: "solid" | "top" | "bottom") => {
            if (pickerFor === "note") {
              if (target === "solid") {
                setLocalNoteOpacity(value);
                setLocalNoteOpacityTop(value);
                setLocalNoteOpacityBottom(value);
                return;
              }
              if (target === "top") {
                setLocalNoteOpacityTop(value);
                setLocalNoteOpacity(Math.round((value + localNoteOpacityBottom) / 2));
                return;
              }
              setLocalNoteOpacityBottom(value);
              setLocalNoteOpacity(Math.round((localNoteOpacityTop + value) / 2));
              return;
            }

            if (target === "solid") {
              setLocalGlowOpacity(value);
              setLocalGlowOpacityTop(value);
              setLocalGlowOpacityBottom(value);
              return;
            }
            if (target === "top") {
              setLocalGlowOpacityTop(value);
              setLocalGlowOpacity(Math.round((value + localGlowOpacityBottom) / 2));
              return;
            }
            setLocalGlowOpacityBottom(value);
            setLocalGlowOpacity(Math.round((localGlowOpacityTop + value) / 2));
          }}
          onOpacityPercentChangeComplete={(value: number, target: "solid" | "top" | "bottom") => {
            if (pickerFor === "note") {
              if (target === "solid") {
                setLocalNoteOpacity(value);
                setLocalNoteOpacityTop(value);
                setLocalNoteOpacityBottom(value);
                const payload = {
                  noteOpacity: value,
                  noteOpacityTop: value,
                  noteOpacityBottom: value,
                };
                onKeyPreview?.(keyIndex, payload);
                onKeyUpdate({ index: keyIndex, ...payload });
                return;
              }

              const nextTop = target === "top" ? value : localNoteOpacityTop;
              const nextBottom = target === "bottom" ? value : localNoteOpacityBottom;
              const nextBase = Math.round((nextTop + nextBottom) / 2);
              setLocalNoteOpacity(nextBase);
              if (target === "top") setLocalNoteOpacityTop(value);
              else setLocalNoteOpacityBottom(value);

              const payload = {
                noteOpacity: nextBase,
                noteOpacityTop: nextTop,
                noteOpacityBottom: nextBottom,
              };
              onKeyPreview?.(keyIndex, payload);
              onKeyUpdate({ index: keyIndex, ...payload });
              return;
            }

            if (target === "solid") {
              setLocalGlowOpacity(value);
              setLocalGlowOpacityTop(value);
              setLocalGlowOpacityBottom(value);
              const payload = {
                noteGlowOpacity: value,
                noteGlowOpacityTop: value,
                noteGlowOpacityBottom: value,
              };
              onKeyPreview?.(keyIndex, payload);
              onKeyUpdate({ index: keyIndex, ...payload });
              return;
            }

            const nextTop = target === "top" ? value : localGlowOpacityTop;
            const nextBottom = target === "bottom" ? value : localGlowOpacityBottom;
            const nextBase = Math.round((nextTop + nextBottom) / 2);
            setLocalGlowOpacity(nextBase);
            if (target === "top") setLocalGlowOpacityTop(value);
            else setLocalGlowOpacityBottom(value);

            const payload = {
              noteGlowOpacity: nextBase,
              noteGlowOpacityTop: nextTop,
              noteGlowOpacityBottom: nextBottom,
            };
            onKeyPreview?.(keyIndex, payload);
            onKeyUpdate({ index: keyIndex, ...payload });
          }}
          opacityPercentLabel={
            pickerFor === "note"
              ? t("keySetting.noteOpacity") || "노트 투명도"
              : t("keySetting.noteGlowOpacity") || "글로우 투명도"
          }
        />
      )}
    </>
  );
};

export default NoteTabContent;
