import React, { useEffect, useRef, useState } from 'react';
import type { ElementShadowSpec } from '@src/types/key/shadows';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import ColorPicker from './ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import { ColorSwatchButton } from './ColorSwatch';
import TabSwitch from '@components/main/common/TabSwitch';
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';

type ShadowState = 'idle' | 'active';

interface ShadowPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  idleShadow: ElementShadowSpec;
  activeShadow: ElementShadowSpec;
  idleMixed?: boolean;
  activeMixed?: boolean;
  onChange: (
    state: ShadowState,
    shadow: ElementShadowSpec,
    patch: Partial<ElementShadowSpec>,
  ) => void;
  onClose: () => void;
  interactiveRefs?: React.RefObject<HTMLElement>[];
  /** 눌림 상태가 없는 요소(통계)는 대기 탭만 노출 */
  showActiveState?: boolean;
  t: (key: string) => string | undefined;
}

const ShadowPicker = ({
  open,
  referenceRef,
  panelElement = null,
  idleShadow,
  activeShadow,
  idleMixed = false,
  activeMixed = false,
  onChange,
  onClose,
  interactiveRefs = [],
  showActiveState = true,
  t,
}: ShadowPickerProps) => {
  const [state, setState] = useState<ShadowState>('idle');
  const [colorOpen, setColorOpen] = useState(false);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  // 입력 탭이 숨겨진 요소(통계)는 이전 선택의 탭 상태와 무관하게 대기만 편집
  const effectiveState = showActiveState ? state : 'idle';
  const current = effectiveState === 'active' ? activeShadow : idleShadow;
  const mixed = effectiveState === 'active' ? activeMixed : idleMixed;
  const [draftColor, setDraftColor] = useState(current.color);

  useEffect(() => {
    if (!showActiveState) {
      setColorOpen(false);
      setState('idle');
      setDraftColor(idleShadow.color);
    }
    // 편집 가능 상태 전환 시점의 최신 대기 색으로 한 번만 강등
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showActiveState]);

  useEffect(() => {
    if (!colorOpen) setDraftColor(current.color);
  }, [current.color, colorOpen]);

  const update = (patch: Partial<ElementShadowSpec>) => {
    onChange(effectiveState, { ...current, ...patch }, patch);
  };

  const handleStateChange = (next: string) => {
    setColorOpen(false);
    setState(next as ShadowState);
  };

  // 컬러 피커가 열려 있으면 한 겹만 닫음
  const handleClose = () => {
    if (colorOpen) {
      setColorOpen(false);
      return;
    }
    onClose();
  };

  const shadowLabel = t('propertiesPanel.shadow') || '그림자';

  return (
    <PickerSurface
      open={open}
      ariaLabel={shadowLabel}
      referenceRef={referenceRef}
      panelElement={panelElement}
      fallbackWidth={204}
      fallbackHeight={210}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[204px] bg-glass-heavy backdrop-glass rounded-popup shadow-elevation-3"
      offsetY={-93}
      interactiveRefs={interactiveRefs}
      onClose={handleClose}
      overlay={
        // 바깥이 닫히면 안쪽도 같이 닫는다. colorOpen만 보면 부모가 퇴장하는
        // 동안 색상 피커만 선명히 남아 있다가 함께 툭 사라진다
        <PopupExit open={open && colorOpen}>
          {colorOpen ? (
            <ColorPicker
              open
              referenceRef={colorButtonRef}
              color={draftColor}
              onColorChange={(color) => {
                if (typeof color === 'string') setDraftColor(color);
              }}
              onColorChangeComplete={(color) => {
                if (typeof color !== 'string') return;
                setDraftColor(color);
                update({ color });
              }}
              onClose={() => setColorOpen(false)}
              solidOnly
              placement="left-start"
              offsetY={0}
              interactiveRefs={[colorButtonRef]}
            />
          ) : null}
        </PopupExit>
      }
    >
      {/* 상태 전환 — 눌림 상태가 없는 요소는 대기만 */}
      {showActiveState ? (
        <TabSwitch
          tabs={[
            { id: 'idle', label: t('propertiesPanel.shadowIdle') || '대기' },
            {
              id: 'active',
              label: t('propertiesPanel.shadowActive') || '입력',
            },
          ]}
          activeTab={effectiveState}
          onTabChange={handleStateChange}
        />
      ) : null}

      <PropertySection>
        <PropertyRow label={t('propertiesPanel.shadowColor') || '색상'}>
          {mixed ? (
            <span className="text-fg-faint text-body italic">Mixed</span>
          ) : null}
          <ColorSwatchButton
            ref={colorButtonRef}
            type="button"
            onClick={() => setColorOpen((prev) => !prev)}
            open={colorOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={draftColor}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.shadowOffset') || '위치'}>
          <NumberInput
            value={current.offsetX}
            onChange={(value) => update({ offsetX: value })}
            prefix="X"
            min={-100}
            max={100}
            allowDecimal
            decimalScale={1}
          />
          <NumberInput
            value={current.offsetY}
            onChange={(value) => update({ offsetY: value })}
            prefix="Y"
            min={-100}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>

        <PropertyRow label={t('propertiesPanel.shadowBlur') || '흐림'}>
          <NumberInput
            value={current.blur}
            onChange={(value) => update({ blur: value })}
            suffix="px"
            min={0}
            max={100}
            allowDecimal
            decimalScale={1}
          />
        </PropertyRow>
      </PropertySection>
    </PickerSurface>
  );
};

export default ShadowPicker;
