/* eslint-disable react-hooks/refs */
import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { useSettingsStore } from '@stores/useSettingsStore';
import ImagePicker from '../pickers/ImagePicker';
import Modal from '../../Modal';
import type { RawInputPayload } from '@src/types/api';

interface KeyData {
  key: string;
  activeImage?: string;
  inactiveImage?: string;
  width?: number;
  height?: number;
  noteColor?: string;
  noteOpacity?: number;
  noteGlowEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowColor?: string;
  className?: string;
  idleTransparent?: boolean;
  activeTransparent?: boolean;
}

interface SaveData {
  key: string;
  activeImage: string;
  inactiveImage: string;
  width: number;
  height: number;
  noteColor?: string;
  noteOpacity?: number;
  noteGlowEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowColor?: string;
  className: string;
  idleTransparent: boolean;
  activeTransparent: boolean;
}

interface KeySettingProps {
  keyData: KeyData;
  onClose: () => void;
  onSave: (data: SaveData) => void;
  skipAnimation?: boolean;
}

export default function KeySetting({
  keyData,
  onClose,
  onSave,
  skipAnimation = false,
}: KeySettingProps) {
  const { t } = useTranslation();
  const { useCustomCSS } = useSettingsStore();
  const [key, setKey] = useState<string>(keyData.key);
  const [displayKey, setDisplayKey] = useState<string>(
    getKeyInfoByGlobalKey(key).displayName,
  );
  const [isListening, setIsListening] = useState<boolean>(false);
  const [activeImage, setActiveImage] = useState<string>(keyData.activeImage || '');
  const [inactiveImage, setInactiveImage] = useState<string>(
    keyData.inactiveImage || '',
  );
  const [width, setWidth] = useState<number | string>(keyData.width || 60);
  const [height, setHeight] = useState<number | string>(keyData.height || 60);
  const [showImagePicker, setShowImagePicker] = useState<boolean>(false);
  const [idleTransparent, setIdleTransparent] = useState<boolean>(
    keyData.idleTransparent || false,
  );
  const [activeTransparent, setActiveTransparent] = useState<boolean>(
    keyData.activeTransparent || false,
  );

  const [className, setClassName] = useState<string>(keyData.className || '');

  const [widthFocused, setWidthFocused] = useState<boolean>(false);
  const [heightFocused, setHeightFocused] = useState<boolean>(false);

  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const initialSkipRef = useRef<boolean>(skipAnimation);
  const listeningFlagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 키 리스닝 플래그를 전역으로 노출 (Grid 단축키 등에서 체크)
  useEffect(() => {
    if (listeningFlagTimerRef.current !== null) {
      clearTimeout(listeningFlagTimerRef.current);
      listeningFlagTimerRef.current = null;
    }

    if (isListening) {
      window.__dmn_isKeyListening = true;
    } else {
      // macOS: raw input이 브라우저 keydown보다 먼저 도착할 수 있어 지연 해제
      listeningFlagTimerRef.current = setTimeout(() => {
        window.__dmn_isKeyListening = false;
        listeningFlagTimerRef.current = null;
      }, 150);
    }

    return () => {
      if (listeningFlagTimerRef.current !== null) {
        clearTimeout(listeningFlagTimerRef.current);
        listeningFlagTimerRef.current = null;
      }
    };
  }, [isListening]);

  // 컴포넌트 언마운트 시 반드시 플래그 해제
  useEffect(() => {
    return () => {
      window.__dmn_isKeyListening = false;
      if (listeningFlagTimerRef.current !== null) {
        clearTimeout(listeningFlagTimerRef.current);
        listeningFlagTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isListening) return undefined;
    if (typeof window === 'undefined' || !window.api?.keys?.onRawInput) {
      return undefined;
    }

    const unsubscribe = window.api.keys.onRawInput((payload: RawInputPayload) => {
      if (!payload || payload.state !== 'DOWN') return;
      const targetLabel =
        payload.label ||
        (Array.isArray(payload.labels) ? payload.labels[0] : null);
      if (!targetLabel) return;

      const info = getKeyInfoByGlobalKey(targetLabel);
      setKey(info.globalKey);
      setDisplayKey(info.displayName);
      setIsListening(false);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error('Failed to unsubscribe raw input listener', error);
      }
    };
  }, [isListening]);

  const handleSubmit = (): void => {
    onSave({
      key,
      activeImage,
      inactiveImage,
      width: parseInt(String(width), 10),
      height: parseInt(String(height), 10),
      noteColor: keyData.noteColor,
      noteOpacity: keyData.noteOpacity,
      noteGlowEnabled: keyData.noteGlowEnabled,
      noteGlowSize: keyData.noteGlowSize,
      noteGlowOpacity: keyData.noteGlowOpacity,
      noteGlowColor: keyData.noteGlowColor,
      className,
      idleTransparent,
      activeTransparent,
    });
  };

  const handleImageButtonClick = (): void => {
    setShowImagePicker((prev) => !prev);
  };

  const handleImagePickerClose = (): void => {
    setShowImagePicker(false);
  };

  return (
    <Modal onClick={onClose} animate={!initialSkipRef.current}>
      <div
        className="flex items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] gap-[19px]"
        onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <div className="flex-1 flex flex-col gap-[19px]">
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t('keySetting.keyMapping')}
            </p>
            <button
              onClick={() => setIsListening(true)}
              className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8.5px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                isListening ? 'border-[#459BF8]' : 'border-[#3A3943]'
              } text-[#DBDEE8] text-style-2`}
            >
              {isListening
                ? t('keySetting.pressAnyKey')
                : displayKey || t('keySetting.clickToSet')}
            </button>
          </div>
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">{t('keySetting.keySize')}</p>
            <div className="flex items-center gap-[10.5px]">
              <div
                className={`relative w-[54px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                  widthFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
                }`}
              >
                <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
                  X
                </span>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    if (newValue === '') {
                      setWidth('');
                    } else {
                      const numValue = parseInt(newValue, 10);
                      if (!Number.isNaN(numValue)) {
                        setWidth(Math.min(Math.max(numValue, 1), 999));
                      }
                    }
                  }}
                  onFocus={() => setWidthFocused(true)}
                  onBlur={(e) => {
                    setWidthFocused(false);
                    if (
                      e.target.value === '' ||
                      Number.isNaN(parseInt(e.target.value, 10))
                    ) {
                      setWidth(60);
                    }
                  }}
                  className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-left"
                />
              </div>
              <div
                className={`relative w-[54px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                  heightFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
                }`}
              >
                <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
                  Y
                </span>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    if (newValue === '') {
                      setHeight('');
                    } else {
                      const numValue = parseInt(newValue, 10);
                      if (!Number.isNaN(numValue)) {
                        setHeight(Math.min(Math.max(numValue, 1), 999));
                      }
                    }
                  }}
                  onFocus={() => setHeightFocused(true)}
                  onBlur={(e) => {
                    setHeightFocused(false);
                    if (
                      e.target.value === '' ||
                      Number.isNaN(parseInt(e.target.value, 10))
                    ) {
                      setHeight(60);
                    }
                  }}
                  className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-left"
                />
              </div>
            </div>
          </div>
          {/* 커스텀 이미지 */}
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t('keySetting.customImage')}
            </p>
            <button
              ref={imageButtonRef}
              type="button"
              className={`px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] flex items-center justify-center ${
                showImagePicker ? 'border-[#459BF8]' : 'border-[#3A3943]'
              } text-[#DBDEE8] text-style-4`}
              onClick={handleImageButtonClick}
            >
              {t('keySetting.configure')}
            </button>
          </div>
          {/* 클래스 이름 - 커스텀 CSS 활성화 시에만 표시 */}
          {useCustomCSS && (
            <div className="flex justify-between w-full items-center">
              <p className="text-white text-style-2">
                {t('keySetting.className')}
              </p>
              <input
                key="classNameUnified"
                type="text"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="className"
                className="text-center w-[90px] h-[23px] p-[6px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
              />
            </div>
          )}
          {/* 저장/취소 버튼 */}
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
        {showImagePicker && (
          <ImagePicker
            open={showImagePicker}
            referenceRef={imageButtonRef}
            idleImage={inactiveImage}
            activeImage={activeImage}
            idleTransparent={idleTransparent}
            activeTransparent={activeTransparent}
            onIdleImageChange={setInactiveImage}
            onActiveImageChange={setActiveImage}
            onIdleTransparentChange={setIdleTransparent}
            onActiveTransparentChange={setActiveTransparent}
            onIdleImageReset={() => setInactiveImage('')}
            onActiveImageReset={() => setActiveImage('')}
            onClose={handleImagePickerClose}
          />
        )}
      </div>
    </Modal>
  );
}
