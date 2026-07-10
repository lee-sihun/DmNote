import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import Checkbox from '@components/main/common/Checkbox';
import {
  COLOR_MODES,
  toGradient,
  type NoteTabState,
  type NotePreviewData,
} from '@hooks/Modal/useUnifiedKeySettingState';

// ============================================================================
// 타입 정의
// ============================================================================

interface NoteTabContentProps {
  state: NoteTabState;
  setState: React.Dispatch<React.SetStateAction<NoteTabState>>;
  onPreview: (updates: Omit<NotePreviewData, 'type'>) => void;
}

interface GradientColorInput {
  type: 'gradient';
  top: string;
  bottom: string;
}

type ColorChangeValue = string | GradientColorInput;

export interface NoteTabContentRef {
  colorButtonRef: React.RefObject<HTMLButtonElement>;
  glowColorButtonRef: React.RefObject<HTMLButtonElement>;
  handleColorChange: (newColor: ColorChangeValue) => void;
  handleColorChangeComplete: (newColor: ColorChangeValue) => void;
  handleGlowColorChange: (newColor: ColorChangeValue) => void;
  handleGlowColorChangeComplete: (newColor: ColorChangeValue) => void;
}

// ============================================================================
// 메인 컴포넌트
// ============================================================================

const NoteTabContent = forwardRef<NoteTabContentRef, NoteTabContentProps>(
  ({ state, setState, onPreview }, ref) => {
    const { t } = useTranslation();
    const colorButtonRef = useRef<HTMLButtonElement>(null);
    const glowColorButtonRef = useRef<HTMLButtonElement>(null);

    // 글로우 비활성화 시 피커 닫기
    useEffect(() => {
      if (!state.glowEnabled && state.showGlowPicker) {
        setState((prev) => ({ ...prev, showGlowPicker: false }));
      }
    }, [state.glowEnabled, state.showGlowPicker, setState]);

    // 색상 미리보기 스타일
    const renderColorPreview = () => {
      if (state.colorMode === COLOR_MODES.gradient) {
        return {
          background: `linear-gradient(to bottom, ${state.noteColor}, ${state.gradientBottom})`,
        };
      }
      return { backgroundColor: state.noteColor };
    };

    const renderGlowColorPreview = () => {
      if (state.glowColorMode === COLOR_MODES.gradient) {
        return {
          background: `linear-gradient(to bottom, ${state.glowColor}, ${state.glowGradientBottom})`,
        };
      }
      return { backgroundColor: state.glowColor };
    };

    // 색상 라벨
    const colorLabel =
      state.colorMode === COLOR_MODES.gradient
        ? 'Gradient'
        : state.noteColor.replace(/^#/, '');
    const glowColorLabel =
      state.glowColorMode === COLOR_MODES.gradient
        ? 'Gradient'
        : state.glowColor.replace(/^#/, '');

    // ref를 통해 버튼 refs와 핸들러 노출
    useImperativeHandle(
      ref,
      () => {
        const handleColorChangeInner = (newColor: ColorChangeValue) => {
          if (typeof newColor === 'object' && newColor.type === 'gradient') {
            setState((prev) => ({
              ...prev,
              colorMode: COLOR_MODES.gradient,
              noteColor: newColor.top,
              gradientBottom: newColor.bottom,
            }));
          } else {
            const solidColor = newColor as string;
            setState((prev) => ({
              ...prev,
              colorMode: COLOR_MODES.solid,
              noteColor: solidColor,
              gradientBottom: solidColor,
            }));
          }
        };

        const handleColorChangeCompleteInner = (newColor: ColorChangeValue) => {
          if (typeof newColor === 'object' && newColor.type === 'gradient') {
            setState((prev) => ({
              ...prev,
              colorMode: COLOR_MODES.gradient,
              noteColor: newColor.top,
              gradientBottom: newColor.bottom,
            }));
            onPreview({ noteColor: toGradient(newColor.top, newColor.bottom) });
          } else {
            const solidColor = newColor as string;
            setState((prev) => ({
              ...prev,
              colorMode: COLOR_MODES.solid,
              noteColor: solidColor,
              gradientBottom: solidColor,
            }));
            onPreview({ noteColor: solidColor });
          }
        };

        const handleGlowColorChangeInner = (newColor: ColorChangeValue) => {
          if (typeof newColor === 'object' && newColor.type === 'gradient') {
            setState((prev) => ({
              ...prev,
              glowColorMode: COLOR_MODES.gradient,
              glowColor: newColor.top,
              glowGradientBottom: newColor.bottom,
            }));
          } else {
            const solidColor = newColor as string;
            setState((prev) => ({
              ...prev,
              glowColorMode: COLOR_MODES.solid,
              glowColor: solidColor,
              glowGradientBottom: solidColor,
            }));
          }
        };

        const handleGlowColorChangeCompleteInner = (
          newColor: ColorChangeValue,
        ) => {
          if (typeof newColor === 'object' && newColor.type === 'gradient') {
            setState((prev) => ({
              ...prev,
              glowColorMode: COLOR_MODES.gradient,
              glowColor: newColor.top,
              glowGradientBottom: newColor.bottom,
            }));
            onPreview({
              noteGlowColor: toGradient(newColor.top, newColor.bottom),
            });
          } else {
            const solidColor = newColor as string;
            setState((prev) => ({
              ...prev,
              glowColorMode: COLOR_MODES.solid,
              glowColor: solidColor,
              glowGradientBottom: solidColor,
            }));
            onPreview({ noteGlowColor: solidColor });
          }
        };

        return {
          colorButtonRef,
          glowColorButtonRef,
          handleColorChange: handleColorChangeInner,
          handleColorChangeComplete: handleColorChangeCompleteInner,
          handleGlowColorChange: handleGlowColorChangeInner,
          handleGlowColorChangeComplete: handleGlowColorChangeCompleteInner,
        };
      },
      [setState, onPreview],
    );

    // 불투명도 핸들러
    const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value.replace(/[^0-9]/g, '');
      if (newValue === '') {
        setState((prev) => ({ ...prev, displayNoteOpacity: '' }));
      } else {
        const numValue = parseInt(newValue, 10);
        if (!Number.isNaN(numValue)) {
          setState((prev) => ({ ...prev, displayNoteOpacity: newValue }));
        }
      }
    };

    const handleOpacityBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const inputValue = e.target.value.replace(/[^0-9]/g, '');
      if (inputValue === '' || Number.isNaN(parseInt(inputValue, 10))) {
        setState((prev) => ({
          ...prev,
          noteOpacity: 80,
          displayNoteOpacity: '80%',
          isFocused: false,
        }));
        onPreview({ noteOpacity: 80 });
      } else {
        const numValue = parseInt(inputValue, 10);
        const clamped = Math.min(Math.max(numValue, 0), 100);
        setState((prev) => ({
          ...prev,
          noteOpacity: clamped,
          displayNoteOpacity: `${clamped}%`,
          isFocused: false,
        }));
        onPreview({ noteOpacity: clamped });
      }
    };

    // 글로우 크기 핸들러 (소수 0.1 단위 허용)
    const sanitizeGlowSize = (raw: string): string => {
      const cleaned = raw.replace(/[^0-9.]/g, '');
      const dotIndex = cleaned.indexOf('.');
      if (dotIndex === -1) return cleaned;
      return (
        cleaned.slice(0, dotIndex + 1) +
        cleaned
          .slice(dotIndex + 1)
          .replace(/\./g, '')
          .slice(0, 1)
      );
    };

    const handleGlowSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = sanitizeGlowSize(e.target.value);
      setState((prev) => ({ ...prev, displayGlowSize: newValue }));
    };

    const handleGlowSizeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const parsed = parseFloat(sanitizeGlowSize(e.target.value));
      const clamped = Number.isNaN(parsed)
        ? 20
        : Number(Math.min(Math.max(parsed, 0), 50).toFixed(1));
      setState((prev) => ({
        ...prev,
        glowSize: clamped,
        displayGlowSize: clamped.toString(),
        glowSizeFocused: false,
      }));
      onPreview({ noteGlowSize: clamped });
    };

    // 글로우 불투명도 핸들러
    const handleGlowOpacityChange = (
      e: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const newValue = e.target.value.replace(/[^0-9]/g, '');
      if (newValue === '') {
        setState((prev) => ({ ...prev, displayGlowOpacity: '' }));
      } else {
        const numValue = parseInt(newValue, 10);
        if (!Number.isNaN(numValue)) {
          setState((prev) => ({ ...prev, displayGlowOpacity: newValue }));
        }
      }
    };

    const handleGlowOpacityBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const inputValue = e.target.value.replace(/[^0-9]/g, '');
      if (inputValue === '' || Number.isNaN(parseInt(inputValue, 10))) {
        setState((prev) => ({
          ...prev,
          glowOpacity: 70,
          displayGlowOpacity: '70%',
          glowOpacityFocused: false,
        }));
        onPreview({ noteGlowOpacity: 70 });
      } else {
        const numValue = parseInt(inputValue, 10);
        const clamped = Math.min(Math.max(numValue, 0), 100);
        setState((prev) => ({
          ...prev,
          glowOpacity: clamped,
          displayGlowOpacity: `${clamped}%`,
          glowOpacityFocused: false,
        }));
        onPreview({ noteGlowOpacity: clamped });
      }
    };

    // 글로우 토글 핸들러
    const handleGlowToggle = () => {
      const newEnabled = !state.glowEnabled;
      setState((prev) => ({ ...prev, glowEnabled: newEnabled }));
      onPreview({ noteGlowEnabled: newEnabled });
    };

    // 노트 효과 토글 핸들러
    const handleNoteEffectToggle = () => {
      const newEnabled = !state.noteEffectEnabled;
      setState((prev) => ({ ...prev, noteEffectEnabled: newEnabled }));
      onPreview({ noteEffectEnabled: newEnabled });
    };

    return (
      <div className="flex flex-col gap-[19px]">
        {/* 색상 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteColor')}
          </p>
          <button
            ref={colorButtonRef}
            type="button"
            className={`relative w-[80px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              state.showPicker ? 'shadow-focus-ring' : ''
            } text-fg text-style-2`}
            onClick={() =>
              setState((prev) => ({ ...prev, showPicker: !prev.showPicker }))
            }
          >
            <div
              className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px]"
              style={renderColorPreview()}
            />
            <span className="ml-[16px] text-left">{colorLabel}</span>
          </button>
        </div>

        {/* 노트 투명도 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteOpacity')}
          </p>
          <input
            type="text"
            value={state.displayNoteOpacity}
            onChange={handleOpacityChange}
            onFocus={() =>
              setState((prev) => ({
                ...prev,
                isFocused: true,
                displayNoteOpacity: prev.noteOpacity.toString(),
              }))
            }
            onBlur={handleOpacityBlur}
            className="text-center w-[47px] h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
          />
        </div>

        <div className="h-px w-full bg-line" />

        {/* 글로우 */}
        <div className="flex flex-col gap-[19px]">
          <div className="flex justify-between w-full items-center">
            <p className="text-fg-muted text-label">
              {t('keySetting.noteGlow')}
            </p>
            <Checkbox checked={state.glowEnabled} onChange={handleGlowToggle} />
          </div>

          <div
            className={`flex justify-between w-full items-center ${
              !state.glowEnabled ? 'opacity-40' : ''
            }`}
          >
            <p className="text-fg-muted text-label">
              {t('keySetting.noteGlowColor')}
            </p>
            <button
              ref={glowColorButtonRef}
              type="button"
              disabled={!state.glowEnabled}
              className={`relative w-[80px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                state.showGlowPicker ? 'shadow-focus-ring' : ''
              } text-fg text-style-2`}
              onClick={() => {
                if (state.glowEnabled) {
                  setState((prev) => ({
                    ...prev,
                    showGlowPicker: !prev.showGlowPicker,
                  }));
                }
              }}
            >
              <div
                className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px]"
                style={renderGlowColorPreview()}
              />
              <span className="ml-[16px] text-left">{glowColorLabel}</span>
            </button>
          </div>

          <div
            className={`flex justify-between w-full items-center ${
              !state.glowEnabled ? 'opacity-40' : ''
            }`}
          >
            <p className="text-fg-muted text-label">
              {t('keySetting.noteGlowSize')}
            </p>
            <input
              type="text"
              inputMode="decimal"
              disabled={!state.glowEnabled}
              value={state.displayGlowSize}
              onChange={handleGlowSizeChange}
              onFocus={() =>
                setState((prev) => ({
                  ...prev,
                  glowSizeFocused: true,
                  displayGlowSize: prev.glowSize.toString(),
                }))
              }
              onBlur={handleGlowSizeBlur}
              className="text-center w-[47px] h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
            />
          </div>

          <div
            className={`flex justify-between w-full items-center ${
              !state.glowEnabled ? 'opacity-40' : ''
            }`}
          >
            <p className="text-fg-muted text-label">
              {t('keySetting.noteGlowOpacity')}
            </p>
            <input
              type="text"
              disabled={!state.glowEnabled}
              value={state.displayGlowOpacity}
              onChange={handleGlowOpacityChange}
              onFocus={() =>
                setState((prev) => ({
                  ...prev,
                  glowOpacityFocused: true,
                  displayGlowOpacity: prev.glowOpacity.toString(),
                }))
              }
              onBlur={handleGlowOpacityBlur}
              className="text-center w-[47px] h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
            />
          </div>
        </div>

        <div className="h-px w-full bg-line" />

        {/* 노트 효과 사용 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteEffectEnabled')}
          </p>
          <Checkbox
            checked={state.noteEffectEnabled}
            onChange={handleNoteEffectToggle}
          />
        </div>

        {/* Y축 자동 보정 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-fg-muted text-label">
            {t('keySetting.noteAutoYCorrection')}
          </p>
          <Checkbox
            checked={state.autoYCorrection}
            onChange={() => {
              const newValue = !state.autoYCorrection;
              setState((prev) => ({ ...prev, autoYCorrection: newValue }));
              onPreview({ noteAutoYCorrection: newValue });
            }}
          />
        </div>
      </div>
    );
  },
);

export default NoteTabContent;
