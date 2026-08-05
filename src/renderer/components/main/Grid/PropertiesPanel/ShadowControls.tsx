import React, { useRef, useState } from 'react';
import type { ElementShadowSpec } from '@src/types/key/shadows';
import ShadowPicker from '@components/main/Modal/content/pickers/ShadowPicker';
import Checkbox from '@components/main/common/Checkbox';
import { PropertyRow, PropertySection } from './PropertyInputs';

type ShadowState = 'idle' | 'active';

interface ShadowControlsProps {
  idleShadow: ElementShadowSpec;
  activeShadow: ElementShadowSpec;
  idleMixed?: boolean;
  activeMixed?: boolean;
  /** 배치 선택 전체 기준 "하나라도 켜짐" — 미지정 시 단일 스펙에서 계산 */
  anyEnabled?: boolean;
  onChange: (
    state: ShadowState,
    shadow: ElementShadowSpec,
    patch: Partial<ElementShadowSpec>,
  ) => void;
  /** 대기·입력 양쪽 enabled를 한 번에 갱신 (마스터 토글) */
  onEnabledChange: (enabled: boolean) => void;
  /** 눌림 상태가 없는 요소(통계)는 대기만 편집 */
  showActiveState?: boolean;
  panelElement?: HTMLElement | null;
  t: (key: string) => string | undefined;
}

const ShadowControls = ({
  idleShadow,
  activeShadow,
  idleMixed = false,
  activeMixed = false,
  anyEnabled: anyEnabledProp,
  onChange,
  onEnabledChange,
  showActiveState = true,
  panelElement,
  t,
}: ShadowControlsProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const configButtonRef = useRef<HTMLButtonElement>(null);
  const anyEnabled =
    anyEnabledProp ??
    (showActiveState
      ? idleShadow.enabled || activeShadow.enabled
      : idleShadow.enabled);
  const mixed = showActiveState ? idleMixed || activeMixed : idleMixed;

  const handleEnabledToggle = () => {
    const next = !anyEnabled;
    if (!next) setPickerOpen(false);
    onEnabledChange(next);
  };

  return (
    <>
      <PropertySection>
        <PropertyRow
          label={t('propertiesPanel.shadowEnabled') || '그림자 사용'}
        >
          {mixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <Checkbox checked={anyEnabled} onChange={handleEnabledToggle} />
        </PropertyRow>

        {anyEnabled ? (
          <PropertyRow label={t('propertiesPanel.shadow') || '그림자'}>
            <button
              ref={configButtonRef}
              type="button"
              className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
                pickerOpen ? 'shadow-focus-ring' : ''
              } text-fg text-body`}
              onClick={() => setPickerOpen((open) => !open)}
            >
              {t('propertiesPanel.configure') || '설정하기'}
            </button>
          </PropertyRow>
        ) : null}
      </PropertySection>

      {pickerOpen ? (
        <ShadowPicker
          open
          referenceRef={configButtonRef}
          panelElement={panelElement}
          idleShadow={idleShadow}
          activeShadow={activeShadow}
          idleMixed={idleMixed}
          activeMixed={activeMixed}
          onChange={onChange}
          showActiveState={showActiveState}
          onClose={() => setPickerOpen(false)}
          interactiveRefs={[configButtonRef]}
          t={t}
        />
      ) : null}
    </>
  );
};

export default ShadowControls;
