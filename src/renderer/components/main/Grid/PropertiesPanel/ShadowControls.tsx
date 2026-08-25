import React, { useRef, useState } from 'react';
import type { ElementShadowSpec } from '@src/types/key/shadows';
import ShadowPicker from '@components/main/Modal/content/pickers/ShadowPicker';
import Checkbox from '@components/main/common/Checkbox';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import PopupExit from '@components/main/Modal/PopupExit';
import { PropertyRow, PropertySection } from './PropertyInputs';
import type { EditStateAnchor } from '@stores/grid/useEditStatePreviewStore';

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
  /** benchmark·호환성 검증용 - 실제 UI는 after-paint 사용 */
  enabledCommitStrategy?: 'after-paint' | 'sync';
  /** 눌림 상태가 없는 요소(통계)는 대기만 편집 */
  showActiveState?: boolean;
  /** 캔버스 상태 프리뷰 대상 - 피커가 열려 있는 동안 편집 상태 발행 */
  previewAnchor?: EditStateAnchor | null;
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
  enabledCommitStrategy = 'after-paint',
  showActiveState = true,
  previewAnchor = null,
  panelElement,
  t,
}: ShadowControlsProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const configButtonRef = useRef<HTMLButtonElement>(null);
  const canonicalEnabled =
    anyEnabledProp ??
    (showActiveState
      ? idleShadow.enabled || activeShadow.enabled
      : idleShadow.enabled);
  const mixed = showActiveState ? idleMixed || activeMixed : idleMixed;
  const { value: anyEnabled, toggle: toggleEnabled } =
    useOptimisticBooleanCommit({
      canonicalValue: canonicalEnabled,
      onCommit: onEnabledChange,
      strategy: enabledCommitStrategy,
      // 토글 자체는 Checkbox라 자기 trackRef를 따로 물고 있다. 여기 버튼 ref는
      // 이 훅이 쓸 창을 정할 뿐이고, 창 판정은 같은 섹션 안 요소면 충분하다
      frameHostRef: configButtonRef,
    });

  // 설정하기 행이 항상 남으므로 열어둔 피커를 끊지 않는다.
  // enabled와 값은 저장 경로가 분리돼 꺼진 상태로도 계속 편집할 수 있다
  const handleEnabledToggle = () => {
    toggleEnabled();
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

        {/* 사용 여부와 무관하게 값 편집은 열어둔다 - 다른 토글과 같은 문법.
            enabled와 값은 저장 경로가 분리돼 있어 꺼진 상태로 미리 맞춰둘 수 있다 */}
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
      </PropertySection>

      <PopupExit open={pickerOpen}>
        {pickerOpen ? (
          <ShadowPicker
            open
            previewAnchor={previewAnchor}
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
      </PopupExit>
    </>
  );
};

export default ShadowControls;
