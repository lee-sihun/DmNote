import React, {
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import { MAX_SLOT_KEYS, buildSlot, slotCompactParts } from '@utils/keySlot';
import type { KeySlotUiMode } from '@utils/keySlot';
import { useKeySlotCapture } from '@hooks/useKeySlotCapture';
import KeySlotPicker from '@components/main/common/KeySlotPicker';
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

    // ref를 통해 imageButtonRef 노출
    useImperativeHandle(
      ref,
      () => ({
        imageButtonRef,
      }),
      [],
    );

    // 캡처 완료 시 멤버 교체 또는 추가 (중복·상한 초과는 무시)
    const { isListening, listenIndex, startListen, stopListen } =
      useKeySlotCapture({
        escapeCancels: true,
        onCapture: (captured, target) => {
          setState((prev) => {
            const members = [...prev.members];
            const duplicateAt = members.indexOf(captured);

            if (target !== null) {
              // 리스닝 중 제거로 인덱스가 밀린 경우 방어
              if (target >= members.length) return prev;
              if (duplicateAt !== -1 && duplicateAt !== target) return prev;
              members[target] = captured;
            } else {
              if (duplicateAt !== -1 || members.length >= MAX_SLOT_KEYS) {
                return prev;
              }
              members.push(captured);
              // 단일 상태에서 키가 늘면 개별 판정으로 승격
              if (prev.mode === 'single') {
                return { ...prev, members, mode: 'any' };
              }
            }
            return { ...prev, members };
          });
        },
      });

    // 멤버 제거 (진행 중 리스닝 취소)
    const handleRemoveMember = (index: number) => {
      stopListen();
      setState((prev) => ({
        ...prev,
        members: prev.members.filter((_, i) => i !== index),
      }));
    };

    // 입력 방식 변경 - 단일로 바꾸면 첫 키만 유지
    const handleModeChange = (mode: KeySlotUiMode) => {
      setState((prev) => ({
        ...prev,
        mode,
        members: mode === 'single' ? prev.members.slice(0, 1) : prev.members,
      }));
    };

    // 멀티 키 편집 팝업
    const [slotPickerOpen, setSlotPickerOpen] = useState(false);
    const slotEditButtonRef = useRef<HTMLButtonElement>(null);
    const slotParts = slotCompactParts(
      buildSlot(state.members, state.mode === 'all' ? 'all' : 'any'),
    );
    // 팝업이 닫혀 있을 때의 리스닝 = 행 버튼 빠른 재지정
    const quickListening = isListening && !slotPickerOpen;

    // 행 버튼: 기존처럼 즉시 캡처 (멀티 슬롯이면 첫 키 교체)
    const handleMainSlotClick = () => {
      startListen(state.members.length === 0 ? null : 0);
    };

    const closeSlotPicker = () => {
      setSlotPickerOpen(false);
      stopListen();
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
      <div className="flex flex-col gap-[12px]">
        {/* 키 매핑·사이즈 카드 */}
        <PropertySection>
          <PropertyRow label={t('keySetting.keyMapping')}>
            <button
              onClick={handleMainSlotClick}
              className={`flex items-center justify-center h-[23px] min-w-[0px] max-w-[120px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
                quickListening ? 'shadow-focus-ring' : ''
              } text-fg text-label`}
            >
              <span className="truncate">
                {quickListening
                  ? t('keySetting.pressAnyKey')
                  : slotParts.label || t('keySetting.clickToSet')}
              </span>
              {!quickListening && slotParts.extra && (
                // case 피처: +를 숫자 중심에 맞춘 글리프로 치환.
                // tracking은 +와 숫자 사이 0.25px 확보용, 끝 글자 뒤 여분은 -mr로 상쇄 (배지는 한 자리 전제)
                <span className="pl-[3px] tracking-[0.25px] -mr-[0.25px] text-fg-faint [font-feature-settings:'case']">
                  {slotParts.extra}
                </span>
              )}
            </button>
          </PropertyRow>

          {/* 다중 키·판정 방식 편집 - 그림자 행과 같은 설정하기 패턴 */}
          <PropertyRow label={t('keySetting.multiKey')}>
            <button
              ref={slotEditButtonRef}
              onClick={() => setSlotPickerOpen((prev) => !prev)}
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                slotPickerOpen ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
            >
              {t('keySetting.configure')}
            </button>
          </PropertyRow>

          <KeySlotPicker
            open={slotPickerOpen}
            referenceRef={slotEditButtonRef}
            onClose={closeSlotPicker}
            members={state.members}
            mode={state.mode}
            isListening={isListening}
            listenIndex={listenIndex}
            onChipClick={(index) => startListen(index)}
            onAddClick={() => startListen(null)}
            onRemove={handleRemoveMember}
            onModeChange={handleModeChange}
            labels={{
              title: t('keySetting.multiKeyEdit'),
              modeAny: t('keySetting.matchAny'),
              modeAll: t('keySetting.matchAll'),
              pressAnyKey: t('keySetting.pressAnyKey'),
              addKey: t('keySetting.addKey'),
              removeKey: t('keySetting.removeKey'),
            }}
          />

          {/* 키 사이즈 */}
          <PropertyRow label={t('keySetting.keySize')}>
            <NumberInput
              value={state.width}
              min={1}
              max={999}
              prefix="X"
              onChange={(value) => {
                setState((prev) => ({ ...prev, width: value }));
                onPreview({ width: value });
              }}
              // Escape 시 값 원복 후 이벤트 전파 - 모달 닫힘 경로 유지
              onCancel={() => {}}
            />
            <NumberInput
              value={state.height}
              min={1}
              max={999}
              prefix="Y"
              onChange={(value) => {
                setState((prev) => ({ ...prev, height: value }));
                onPreview({ height: value });
              }}
              onCancel={() => {}}
            />
          </PropertyRow>
        </PropertySection>

        {/* 외형 커스터마이징 카드 */}
        <PropertySection>
          {/* 커스텀 이미지 */}
          <div className="flex justify-between items-center w-full min-h-[32px]">
            <p className="text-fg-muted text-label">
              {t('keySetting.customImage')}
            </p>
            <button
              ref={imageButtonRef}
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                state.showImagePicker ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
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
            <PropertyRow label={t('keySetting.className')}>
              <input
                type="text"
                value={state.className}
                onChange={handleClassNameChange}
                placeholder="className"
                className="text-center w-[90px] h-[23px] p-[6px] bg-inset rounded-md focus:shadow-focus-ring text-body tabular-nums text-fg"
              />
            </PropertyRow>
          )}
        </PropertySection>
      </div>
    );
  },
);

export default KeyTabContent;
