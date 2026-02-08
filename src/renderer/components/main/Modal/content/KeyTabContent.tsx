import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useTranslation } from "@contexts/I18nContext";
import { useSettingsStore } from "@stores/useSettingsStore";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import type {
  KeyTabState,
  KeyPreviewData,
} from "@hooks/Modal/useUnifiedKeySettingState";

// ============================================================================
// 타입 정의
// ============================================================================

interface KeyTabContentProps {
  state: KeyTabState;
  setState: React.Dispatch<React.SetStateAction<KeyTabState>>;
  onPreview: (updates: Omit<KeyPreviewData, "type">) => void;
}

export interface KeyTabContentRef {
  imageButtonRef: React.RefObject<HTMLButtonElement>;
}

// ============================================================================
// 컴포넌트
// ============================================================================

const KeyTabContent = forwardRef<KeyTabContentRef, KeyTabContentProps>(
  ({ state, setState, onPreview }, ref) => {
    const { t } = useTranslation();
    const { useCustomCSS } = useSettingsStore();
    const imageButtonRef = useRef<HTMLButtonElement>(null);
    const justAssignedRef = useRef<boolean>(false);

    // ref를 통해 imageButtonRef 노출
    useImperativeHandle(
      ref,
      () => ({
        imageButtonRef,
      }),
      [],
    );

    // 키 리스닝 중 브라우저 기본 동작 차단
    useEffect(() => {
      if (!state.isListening) return undefined;

      if (typeof window !== "undefined") {
        (window as any).__dmn_isKeyListening = true;
      }

      const blockKeyboardEvents = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };

      const blockMouseEvents = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };

      const blockContextMenu = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };

      // 캡처 단계에서 모든 키보드/마우스 이벤트 차단
      window.addEventListener("keydown", blockKeyboardEvents, true);
      window.addEventListener("keyup", blockKeyboardEvents, true);
      window.addEventListener("keypress", blockKeyboardEvents, true);
      window.addEventListener("mousedown", blockMouseEvents, true);
      window.addEventListener("contextmenu", blockContextMenu, true);

      return () => {
        if (typeof window !== "undefined") {
          (window as any).__dmn_isKeyListening = false;
        }
        window.removeEventListener("keydown", blockKeyboardEvents, true);
        window.removeEventListener("keyup", blockKeyboardEvents, true);
        window.removeEventListener("keypress", blockKeyboardEvents, true);
        window.removeEventListener("mousedown", blockMouseEvents, true);
        window.removeEventListener("contextmenu", blockContextMenu, true);
      };
    }, [state.isListening]);

    // 키 리스닝 effect
    useEffect(() => {
      if (!state.isListening) return undefined;
      if (typeof window === "undefined" || !window.api?.keys?.onRawInput) {
        return undefined;
      }

      const unsubscribe = window.api.keys.onRawInput((payload: any) => {
        if (!payload || payload.state !== "DOWN") return;
        const targetLabel =
          payload.label ||
          (Array.isArray(payload.labels) ? payload.labels[0] : null);
        if (!targetLabel) return;

        const info = getKeyInfoByGlobalKey(targetLabel);

        // 마우스 클릭으로 할당 시 버튼 재클릭 방지를 위한 플래그
        justAssignedRef.current = true;
        setTimeout(() => {
          justAssignedRef.current = false;
        }, 100);

        setState((prev) => ({
          ...prev,
          key: info.globalKey,
          displayKey: info.displayName,
          isListening: false,
        }));
      });

      return () => {
        try {
          unsubscribe?.();
        } catch (error) {
          console.error("Failed to unsubscribe raw input listener", error);
        }
      };
    }, [state.isListening, setState]);

    // 키 리스닝 핸들러
    const handleKeyListen = React.useCallback(() => {
      // 방금 키가 할당된 직후라면 무시 (마우스 클릭 할당 시 버튼 재클릭 방지)
      if (justAssignedRef.current) return;
      setState((prev) => ({ ...prev, isListening: true }));
    }, [setState]);

    // 이미지 변경 핸들러
    const handleIdleImageChange = React.useCallback(
      (imageUrl: string) => {
        setState((prev) => ({ ...prev, inactiveImage: imageUrl }));
        onPreview({ inactiveImage: imageUrl });
      },
      [setState, onPreview],
    );

    const handleActiveImageChange = React.useCallback(
      (imageUrl: string) => {
        setState((prev) => ({ ...prev, activeImage: imageUrl }));
        onPreview({ activeImage: imageUrl });
      },
      [setState, onPreview],
    );

    // 크기 변경 핸들러
    const handleWidthChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        if (newValue === "") {
          setState((prev) => ({ ...prev, width: "" }));
        } else {
          const numValue = parseInt(newValue, 10);
          if (!Number.isNaN(numValue)) {
            const clamped = Math.min(Math.max(numValue, 1), 999);
            setState((prev) => ({ ...prev, width: clamped }));
            onPreview({ width: clamped });
          }
        }
      },
      [setState, onPreview],
    );

    const handleHeightChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        if (newValue === "") {
          setState((prev) => ({ ...prev, height: "" }));
        } else {
          const numValue = parseInt(newValue, 10);
          if (!Number.isNaN(numValue)) {
            const clamped = Math.min(Math.max(numValue, 1), 999);
            setState((prev) => ({ ...prev, height: clamped }));
            onPreview({ height: clamped });
          }
        }
      },
      [setState, onPreview],
    );

    // 투명 토글 핸들러
    const handleIdleTransparentChange = React.useCallback(
      (checked: boolean) => {
        setState((prev) => ({ ...prev, idleTransparent: checked }));
        onPreview({ idleTransparent: checked });
      },
      [setState, onPreview],
    );

    const handleActiveTransparentChange = React.useCallback(
      (checked: boolean) => {
        setState((prev) => ({ ...prev, activeTransparent: checked }));
        onPreview({ activeTransparent: checked });
      },
      [setState, onPreview],
    );

    // 클래스 변경 핸들러
    const handleClassNameChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setState((prev) => ({ ...prev, className: value }));
        onPreview({ className: value });
      },
      [setState, onPreview],
    );

    return (
      <div className="flex flex-col gap-[19px]">
        {/* 키 매핑 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t("keySetting.keyMapping")}
          </p>
          <button
            onClick={handleKeyListen}
            className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8.5px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
              state.isListening ? "border-[#459BF8]" : "border-[#3A3943]"
            } text-[#DBDEE8] text-style-2`}
          >
            {state.isListening
              ? t("keySetting.pressAnyKey")
              : state.displayKey || t("keySetting.clickToSet")}
          </button>
        </div>

        {/* 키 사이즈 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t("keySetting.keySize")}</p>
          <div className="flex items-center gap-[10.5px]">
            <div
              className={`relative w-[54px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                state.widthFocused ? "border-[#459BF8]" : "border-[#3A3943]"
              }`}
            >
              <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
                X
              </span>
              <input
                type="number"
                value={state.width}
                onChange={handleWidthChange}
                onFocus={() =>
                  setState((prev) => ({ ...prev, widthFocused: true }))
                }
                onBlur={(e) => {
                  setState((prev) => {
                    const val = e.target.value;
                    const finalVal =
                      val === "" || Number.isNaN(parseInt(val, 10))
                        ? 60
                        : parseInt(val, 10);
                    return { ...prev, width: finalVal, widthFocused: false };
                  });
                }}
                className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-left"
              />
            </div>
            <div
              className={`relative w-[54px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                state.heightFocused ? "border-[#459BF8]" : "border-[#3A3943]"
              }`}
            >
              <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
                Y
              </span>
              <input
                type="number"
                value={state.height}
                onChange={handleHeightChange}
                onFocus={() =>
                  setState((prev) => ({ ...prev, heightFocused: true }))
                }
                onBlur={(e) => {
                  setState((prev) => {
                    const val = e.target.value;
                    const finalVal =
                      val === "" || Number.isNaN(parseInt(val, 10))
                        ? 60
                        : parseInt(val, 10);
                    return { ...prev, height: finalVal, heightFocused: false };
                  });
                }}
                className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-left"
              />
            </div>
          </div>
        </div>

        {/* 커스텀 이미지 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t("keySetting.customImage")}
          </p>
          <button
            ref={imageButtonRef}
            type="button"
            className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
              state.showImagePicker ? "border-[#459BF8]" : "border-[#3A3943]"
            } text-[#DBDEE8] text-style-4`}
            onClick={() =>
              setState((prev) => ({
                ...prev,
                showImagePicker: !prev.showImagePicker,
              }))
            }
          >
            {t("keySetting.configure")}
          </button>
        </div>

        {/* 클래스 이름 - 커스텀 CSS 활성화 시에만 표시 */}
        {useCustomCSS && (
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t("keySetting.className")}
            </p>
            <input
              type="text"
              value={state.className}
              onChange={handleClassNameChange}
              placeholder="className"
              className="text-center w-[90px] h-[23px] p-[6px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
            />
          </div>
        )}
      </div>
    );
  },
);

export default KeyTabContent;
