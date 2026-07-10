import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useSettingsStore } from '@stores/useSettingsStore';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import type {
  KeyTabState,
  KeyPreviewData,
} from '@hooks/Modal/useUnifiedKeySettingState';

// ============================================================================
// 타입 정의
// ============================================================================

interface KeyTabContentProps {
  state: KeyTabState;
  setState: React.Dispatch<React.SetStateAction<KeyTabState>>;
  onPreview: (updates: Omit<KeyPreviewData, 'type'>) => void;
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
    const listeningFlagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

    // ref를 통해 imageButtonRef 노출
    useImperativeHandle(
      ref,
      () => ({
        imageButtonRef,
      }),
      [],
    );

    // 키 리스닝 플래그를 전역으로 노출 (Grid 단축키 등에서 체크)
    useEffect(() => {
      // 이전 타이머 정리
      if (listeningFlagTimerRef.current !== null) {
        clearTimeout(listeningFlagTimerRef.current);
        listeningFlagTimerRef.current = null;
      }

      if (state.isListening) {
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
    }, [state.isListening]);

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

    // 키 리스닝 중 브라우저 기본 동작 차단
    useEffect(() => {
      if (!state.isListening) return undefined;

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
      window.addEventListener('keydown', blockKeyboardEvents, true);
      window.addEventListener('keyup', blockKeyboardEvents, true);
      window.addEventListener('keypress', blockKeyboardEvents, true);
      window.addEventListener('mousedown', blockMouseEvents, true);
      window.addEventListener('contextmenu', blockContextMenu, true);

      return () => {
        window.removeEventListener('keydown', blockKeyboardEvents, true);
        window.removeEventListener('keyup', blockKeyboardEvents, true);
        window.removeEventListener('keypress', blockKeyboardEvents, true);
        window.removeEventListener('mousedown', blockMouseEvents, true);
        window.removeEventListener('contextmenu', blockContextMenu, true);
      };
    }, [state.isListening]);

    // 키 리스닝 effect
    useEffect(() => {
      if (!state.isListening) return undefined;
      if (typeof window === 'undefined' || !window.api?.keys?.onRawInput) {
        return undefined;
      }

      const unsubscribe = window.api.keys.onRawInput((payload) => {
        if (!payload || payload.state !== 'DOWN') return;
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
          console.error('Failed to unsubscribe raw input listener', error);
        }
      };
    }, [state.isListening, setState]);

    // 키 리스닝 핸들러
    const handleKeyListen = () => {
      // 방금 키가 할당된 직후라면 무시 (마우스 클릭 할당 시 버튼 재클릭 방지)
      if (justAssignedRef.current) return;
      setState((prev) => ({ ...prev, isListening: true }));
    };

    // 이미지 변경 핸들러
    const _handleIdleImageChange = (imageUrl: string) => {
      setState((prev) => ({ ...prev, inactiveImage: imageUrl }));
      onPreview({ inactiveImage: imageUrl });
    };

    const _handleActiveImageChange = (imageUrl: string) => {
      setState((prev) => ({ ...prev, activeImage: imageUrl }));
      onPreview({ activeImage: imageUrl });
    };

    // 크기 변경 핸들러
    const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      if (newValue === '') {
        setState((prev) => ({ ...prev, width: '' }));
      } else {
        const numValue = parseInt(newValue, 10);
        if (!Number.isNaN(numValue)) {
          const clamped = Math.min(Math.max(numValue, 1), 999);
          setState((prev) => ({ ...prev, width: clamped }));
          onPreview({ width: clamped });
        }
      }
    };

    const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      if (newValue === '') {
        setState((prev) => ({ ...prev, height: '' }));
      } else {
        const numValue = parseInt(newValue, 10);
        if (!Number.isNaN(numValue)) {
          const clamped = Math.min(Math.max(numValue, 1), 999);
          setState((prev) => ({ ...prev, height: clamped }));
          onPreview({ height: clamped });
        }
      }
    };

    // 투명 토글 핸들러
    const _handleIdleTransparentChange = (checked: boolean) => {
      setState((prev) => ({ ...prev, idleTransparent: checked }));
      onPreview({ idleTransparent: checked });
    };

    const _handleActiveTransparentChange = (checked: boolean) => {
      setState((prev) => ({ ...prev, activeTransparent: checked }));
      onPreview({ activeTransparent: checked });
    };

    // 클래스 변경 핸들러
    const handleClassNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setState((prev) => ({ ...prev, className: value }));
      onPreview({ className: value });
    };

    return (
      <div className="flex flex-col gap-[19px]">
        {/* 키 매핑 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t('keySetting.keyMapping')}
          </p>
          <button
            onClick={handleKeyListen}
            className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8.5px] bg-inset rounded-md ${
              state.isListening ? 'shadow-focus-ring' : ''
            } text-fg text-style-2`}
          >
            {state.isListening
              ? t('keySetting.pressAnyKey')
              : state.displayKey || t('keySetting.clickToSet')}
          </button>
        </div>

        {/* 키 사이즈 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('keySetting.keySize')}</p>
          <div className="flex items-center gap-[10.5px]">
            <div
              className={`relative w-[54px] h-[23px] bg-inset rounded-md ${
                state.widthFocused ? 'shadow-focus-ring' : ''
              }`}
            >
              <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-fg-muted text-style-1 pointer-events-none">
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
                      val === '' || Number.isNaN(parseInt(val, 10))
                        ? 60
                        : parseInt(val, 10);
                    return { ...prev, width: finalVal, widthFocused: false };
                  });
                }}
                className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-fg text-left"
              />
            </div>
            <div
              className={`relative w-[54px] h-[23px] bg-inset rounded-md ${
                state.heightFocused ? 'shadow-focus-ring' : ''
              }`}
            >
              <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-fg-muted text-style-1 pointer-events-none">
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
                      val === '' || Number.isNaN(parseInt(val, 10))
                        ? 60
                        : parseInt(val, 10);
                    return { ...prev, height: finalVal, heightFocused: false };
                  });
                }}
                className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-fg text-left"
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
            className={`px-[7px] h-[23px] bg-inset rounded-md border-[1px] flex items-center justify-center ${
              state.showImagePicker ? 'shadow-focus-ring' : ''
            } text-fg text-style-4`}
            onClick={() =>
              setState((prev) => ({
                ...prev,
                showImagePicker: !prev.showImagePicker,
              }))
            }
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
              type="text"
              value={state.className}
              onChange={handleClassNameChange}
              placeholder="className"
              className="text-center w-[90px] h-[23px] p-[6px] bg-inset rounded-md focus:shadow-focus-ring text-style-4 text-fg"
            />
          </div>
        )}
      </div>
    );
  },
);

export default KeyTabContent;
