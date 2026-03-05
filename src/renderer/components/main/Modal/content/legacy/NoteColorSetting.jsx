import React, { useState, useRef, useEffect } from 'react';
import Modal from '../Modal';
import ColorPicker from './ColorPicker';
import { useTranslation } from '@contexts/I18nContext';
import { isGradientColor, normalizeColorInput } from '@utils/colorUtils';
import Checkbox from '@components/main/common/Checkbox';

const COLOR_MODES = {
  solid: 'solid',
  gradient: 'gradient',
};

const toGradient = (top, bottom) => ({ type: 'gradient', top, bottom });

export default function NoteColorSettingModal({
  onClose,
  onSave,
  initialNoteColor,
  initialNoteOpacity,
  initialNoteGlowSize,
  initialNoteGlowOpacity,
  initialNoteGlowEnabled,
  initialNoteGlowColor,
}) {
  const { t } = useTranslation();
  const initialGlowSource = initialNoteGlowColor ?? initialNoteColor;

  const [colorMode, setColorMode] = useState(
    isGradientColor(initialNoteColor)
      ? COLOR_MODES.gradient
      : COLOR_MODES.solid,
  );
  const [noteColor, setNoteColor] = useState(() =>
    normalizeColorInput(initialNoteColor),
  );
  const [gradientBottom, setGradientBottom] = useState(() =>
    isGradientColor(initialNoteColor)
      ? initialNoteColor.bottom
      : normalizeColorInput(initialNoteColor),
  );
  const [noteOpacity, setNoteOpacity] = useState(initialNoteOpacity ?? 80);
  const [glowEnabled, setGlowEnabled] = useState(
    initialNoteGlowEnabled ?? false,
  );
  const [glowSize, setGlowSize] = useState(
    typeof initialNoteGlowSize === 'number' ? initialNoteGlowSize : 20,
  );
  const [glowOpacity, setGlowOpacity] = useState(
    typeof initialNoteGlowOpacity === 'number' ? initialNoteGlowOpacity : 70,
  );
  const [glowColor, setGlowColor] = useState(() =>
    isGradientColor(initialGlowSource)
      ? normalizeColorInput(initialGlowSource.top)
      : normalizeColorInput(initialGlowSource),
  );
  const [glowGradientBottom, setGlowGradientBottom] = useState(() =>
    isGradientColor(initialGlowSource)
      ? normalizeColorInput(initialGlowSource.bottom)
      : normalizeColorInput(initialGlowSource),
  );
  const [glowColorMode, setGlowColorMode] = useState(
    isGradientColor(initialGlowSource)
      ? COLOR_MODES.gradient
      : COLOR_MODES.solid,
  );
  const [showPicker, setShowPicker] = useState(false);
  const [showGlowPicker, setShowGlowPicker] = useState(false);

  const [isFocused, setIsFocused] = useState(false);
  const [displayNoteOpacity, setDisplayNoteOpacity] = useState(
    typeof initialNoteOpacity === 'number' ? `${initialNoteOpacity}%` : '80%',
  );
  const [glowSizeFocused, setGlowSizeFocused] = useState(false);
  const [glowOpacityFocused, setGlowOpacityFocused] = useState(false);
  const [displayGlowSize, setDisplayGlowSize] = useState(
    typeof initialNoteGlowSize === 'number'
      ? initialNoteGlowSize.toString()
      : '20',
  );
  const [displayGlowOpacity, setDisplayGlowOpacity] = useState(
    typeof initialNoteGlowOpacity === 'number'
      ? `${initialNoteGlowOpacity}%`
      : '70%',
  );

  const colorButtonRef = useRef(null);
  const glowColorButtonRef = useRef(null);

  useEffect(() => {
    if (!glowEnabled && showGlowPicker) {
      setShowGlowPicker(false);
    }
  }, [glowEnabled, showGlowPicker]);

  useEffect(() => {
    if (!isFocused) {
      setDisplayNoteOpacity(`${noteOpacity}%`);
    }
  }, [noteOpacity, isFocused]);

  useEffect(() => {
    if (!glowSizeFocused) {
      setDisplayGlowSize(glowSize.toString());
    }
  }, [glowSize, glowSizeFocused]);

  useEffect(() => {
    if (!glowOpacityFocused) {
      setDisplayGlowOpacity(`${glowOpacity}%`);
    }
  }, [glowOpacity, glowOpacityFocused]);

  const handleSubmit = () => {
    const colorValue =
      colorMode === COLOR_MODES.gradient
        ? toGradient(noteColor, gradientBottom)
        : noteColor;
    onSave({
      noteColor: colorValue,
      noteOpacity,
      noteGlowEnabled: glowEnabled,
      noteGlowSize: glowSize,
      noteGlowOpacity: glowOpacity,
      noteGlowColor:
        glowColorMode === COLOR_MODES.gradient
          ? toGradient(glowColor, glowGradientBottom)
          : glowColor,
    });
  };

  const handleColorButtonClick = () => {
    setShowPicker((prev) => !prev);
  };

  const handleGlowColorButtonClick = () => {
    if (!glowEnabled) return;
    setShowGlowPicker((prev) => !prev);
  };

  const handleColorChange = (newColor) => {
    if (isGradientColor(newColor)) {
      setColorMode(COLOR_MODES.gradient);
      setNoteColor(newColor.top);
      setGradientBottom(newColor.bottom);
    } else {
      setColorMode(COLOR_MODES.solid);
      setNoteColor(newColor);
      setGradientBottom(newColor);
    }
  };

  const handleGlowColorChange = (newColor) => {
    if (isGradientColor(newColor)) {
      setGlowColorMode(COLOR_MODES.gradient);
      setGlowColor(newColor.top);
      setGlowGradientBottom(newColor.bottom);
    } else {
      setGlowColorMode(COLOR_MODES.solid);
      setGlowColor(newColor);
      setGlowGradientBottom(newColor);
    }
  };

  const handlePickerClose = () => {
    setShowPicker(false);
  };
  const handleGlowPickerClose = () => {
    setShowGlowPicker(false);
  };

  const renderColorPreview = () => {
    if (colorMode === COLOR_MODES.gradient) {
      return {
        background: `linear-gradient(to bottom, ${noteColor}, ${gradientBottom})`,
      };
    }
    return { backgroundColor: noteColor };
  };

  const renderGlowColorPreview = () => {
    if (glowColorMode === COLOR_MODES.gradient) {
      return {
        background: `linear-gradient(to bottom, ${glowColor}, ${glowGradientBottom})`,
      };
    }
    return { backgroundColor: glowColor };
  };

  const colorLabel =
    colorMode === COLOR_MODES.gradient
      ? 'Gradient'
      : noteColor.replace(/^#/, '');
  const glowColorLabel =
    glowColorMode === COLOR_MODES.gradient
      ? 'Gradient'
      : glowColor.replace(/^#/, '');

  return (
    <Modal onClick={onClose}>
      <div
        className="flex items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] gap-[19px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 flex flex-col gap-[19px]">
          {/* 색상 */}
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t('keySetting.noteColor')}
            </p>
            <button
              ref={colorButtonRef}
              type="button"
              className={`relative w-[80px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                showPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
              } text-[#DBDEE8] text-style-2`}
              onClick={handleColorButtonClick}
            >
              <div
                className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px] border border-[#3A3943]"
                style={renderColorPreview()}
              ></div>
              <span className="ml-[16px] text-left">{colorLabel}</span>
            </button>
          </div>

          {/* 노트 투명도 */}
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t('keySetting.noteOpacity')}
            </p>
            <input
              type="text"
              value={displayNoteOpacity}
              onChange={(e) => {
                const newValue = e.target.value.replace(/[^0-9]/g, '');
                if (newValue === '') {
                  setDisplayNoteOpacity('');
                } else {
                  const numValue = parseInt(newValue, 10);
                  if (!Number.isNaN(numValue)) {
                    setDisplayNoteOpacity(newValue);
                  }
                }
              }}
              onFocus={() => {
                setIsFocused(true);
                setDisplayNoteOpacity(noteOpacity.toString());
              }}
              onBlur={(e) => {
                setIsFocused(false);
                const inputValue = e.target.value.replace(/[^0-9]/g, '');
                if (
                  inputValue === '' ||
                  Number.isNaN(parseInt(inputValue, 10))
                ) {
                  setNoteOpacity(80);
                  setDisplayNoteOpacity('80%');
                } else {
                  const numValue = parseInt(inputValue, 10);
                  const clamped = Math.min(Math.max(numValue, 0), 100);
                  setNoteOpacity(clamped);
                  setDisplayNoteOpacity(`${clamped}%`);
                }
              }}
              className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
            />
          </div>

          <div className="h-px w-full bg-[#2A2A30]" />

          {/* 글로우 */}
          <div className="flex flex-col gap-[19px]">
            <div className="flex justify-between w-full items-center">
              <p className="text-white text-style-2">
                {t('keySetting.noteGlow')}
              </p>
              <Checkbox
                checked={glowEnabled}
                onChange={() => setGlowEnabled((prev) => !prev)}
              />
            </div>

            <div
              className={`flex justify-between w-full items-center ${
                !glowEnabled ? 'opacity-40' : ''
              }`}
            >
              <p className="text-white text-style-2">
                {t('keySetting.noteGlowColor')}
              </p>
              <button
                ref={glowColorButtonRef}
                type="button"
                disabled={!glowEnabled}
                className={`relative w-[80px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                  showGlowPicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
                } text-[#DBDEE8] text-style-2`}
                onClick={handleGlowColorButtonClick}
              >
                <div
                  className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px] border border-[#3A3943]"
                  style={renderGlowColorPreview()}
                ></div>
                <span className="ml-[16px] text-left">{glowColorLabel}</span>
              </button>
            </div>

            <div
              className={`flex justify-between w-full items-center ${
                !glowEnabled ? 'opacity-40' : ''
              }`}
            >
              <p className="text-white text-style-2">
                {t('keySetting.noteGlowSize')}
              </p>
              <input
                type="text"
                disabled={!glowEnabled}
                value={displayGlowSize}
                onChange={(e) => {
                  const newValue = e.target.value.replace(/[^0-9]/g, '');
                  setDisplayGlowSize(newValue);
                }}
                onFocus={() => {
                  setGlowSizeFocused(true);
                  setDisplayGlowSize(glowSize.toString());
                }}
                onBlur={(e) => {
                  setGlowSizeFocused(false);
                  const parsed = parseInt(
                    e.target.value.replace(/[^0-9]/g, ''),
                    10,
                  );
                  const clamped = Number.isNaN(parsed)
                    ? 20
                    : Math.min(Math.max(parsed, 0), 50);
                  setGlowSize(clamped);
                  setDisplayGlowSize(clamped.toString());
                }}
                className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
              />
            </div>

            <div
              className={`flex justify-between w-full items-center ${
                !glowEnabled ? 'opacity-40' : ''
              }`}
            >
              <p className="text-white text-style-2">
                {t('keySetting.noteGlowOpacity')}
              </p>
              <input
                type="text"
                disabled={!glowEnabled}
                value={displayGlowOpacity}
                onChange={(e) => {
                  const newValue = e.target.value.replace(/[^0-9]/g, '');
                  if (newValue === '') {
                    setDisplayGlowOpacity('');
                  } else {
                    const numValue = parseInt(newValue, 10);
                    if (!Number.isNaN(numValue)) {
                      setDisplayGlowOpacity(newValue);
                    }
                  }
                }}
                onFocus={() => {
                  setGlowOpacityFocused(true);
                  setDisplayGlowOpacity(glowOpacity.toString());
                }}
                onBlur={(e) => {
                  setGlowOpacityFocused(false);
                  const inputValue = e.target.value.replace(/[^0-9]/g, '');
                  if (
                    inputValue === '' ||
                    Number.isNaN(parseInt(inputValue, 10))
                  ) {
                    setGlowOpacity(70);
                    setDisplayGlowOpacity('70%');
                  } else {
                    const numValue = parseInt(inputValue, 10);
                    const clamped = Math.min(Math.max(numValue, 0), 100);
                    setGlowOpacity(clamped);
                    setDisplayGlowOpacity(`${clamped}%`);
                  }
                }}
                className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
              />
            </div>
          </div>

          <div className="flex gap-[10.5px]">
            <button
              onClick={handleSubmit}
              className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
            >
              {t('keySetting.save')}
            </button>
            <button
              onClick={onClose}
              className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
            >
              {t('keySetting.cancel')}
            </button>
          </div>
        </div>
        {showPicker && (
          <ColorPicker
            open={showPicker}
            referenceRef={colorButtonRef}
            color={
              colorMode === COLOR_MODES.gradient
                ? toGradient(noteColor, gradientBottom)
                : noteColor
            }
            onColorChange={handleColorChange}
            onClose={handlePickerClose}
          />
        )}
        {showGlowPicker && (
          <ColorPicker
            open={showGlowPicker}
            referenceRef={glowColorButtonRef}
            color={
              glowColorMode === COLOR_MODES.gradient
                ? toGradient(glowColor, glowGradientBottom)
                : glowColor
            }
            onColorChange={handleGlowColorChange}
            onClose={handleGlowPickerClose}
          />
        )}
      </div>
    </Modal>
  );
}
