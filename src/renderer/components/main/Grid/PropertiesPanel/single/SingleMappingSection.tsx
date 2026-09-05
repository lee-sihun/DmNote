import React, { useEffect, useRef, useState } from 'react';
import type { KeySlot } from '@src/types/key/keys';
import type { KeySlotUiMode } from '@utils/keySlot';
import {
  MAX_SLOT_KEYS,
  buildSlot,
  slotCanonical,
  slotCompactParts,
  slotMembers,
  slotUiMode,
} from '@utils/keySlot';
import { useKeySlotCapture } from '@hooks/useKeySlotCapture';
import KeySlotPicker from '@components/main/common/KeySlotPicker';
import { PropertyRow, PropertySection } from '../PropertyInputs';

interface SingleMappingSectionProps {
  keyIndex: number;
  keySlot?: KeySlot | null;
  onKeyMappingChange?: (index: number, newSlot: KeySlot) => void;
  mappingControl?: React.ReactNode;
  mappingControlLayout?: React.ReactNode;
  mappingLabel?: string;
  panelElement?: HTMLElement | null;
  t: (key: string) => string;
}

const SingleMappingSection = ({
  keyIndex,
  keySlot,
  onKeyMappingChange,
  mappingControl,
  mappingControlLayout,
  mappingLabel,
  panelElement,
  t,
}: SingleMappingSectionProps) => {
  const slotEditable = keySlot != null && Boolean(onKeyMappingChange);
  const members = keySlot != null ? slotMembers(keySlot) : [];
  const slotIdentityKey = `${keyIndex}:${
    keySlot != null ? slotCanonical(keySlot) : ''
  }`;
  const [slotMode, setSlotMode] = useState<KeySlotUiMode>(() =>
    keySlot != null ? slotUiMode(keySlot) : 'single',
  );
  useEffect(() => {
    setSlotMode(keySlot != null ? slotUiMode(keySlot) : 'single');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotIdentityKey]);

  const commitMembers = (
    nextMembers: string[],
    mode: KeySlotUiMode = slotMode,
  ) => {
    const sliced = mode === 'single' ? nextMembers.slice(0, 1) : nextMembers;
    onKeyMappingChange?.(
      keyIndex,
      buildSlot(sliced, mode === 'all' ? 'all' : 'any'),
    );
  };

  const handleSlotModeChange = (mode: KeySlotUiMode) => {
    setSlotMode(mode);
    if (mode === 'single') {
      if (members.length > 1) commitMembers(members, 'single');
    } else if (members.length >= 2) {
      commitMembers(members, mode);
    }
  };

  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const slotEditButtonRef = useRef<HTMLButtonElement>(null);
  const slotParts = slotCompactParts(
    buildSlot(members, slotMode === 'all' ? 'all' : 'any'),
  );
  const {
    isListening: slotListening,
    listenIndex: slotListenIndex,
    startListen: startSlotListen,
    stopListen: stopSlotListen,
  } = useKeySlotCapture({
    escapeCancels: true,
    onCapture: (captured, target) => {
      const duplicateAt = members.indexOf(captured);
      if (target !== null) {
        // 리스닝 중 제거로 인덱스가 밀린 경우 방어
        if (target >= members.length) return;
        // 멤버 교체, 다른 자리에 이미 있는 키는 무시
        if (duplicateAt !== -1 && duplicateAt !== target) return;
        const next = [...members];
        next[target] = captured;
        commitMembers(next);
      } else {
        // 멤버 추가, 중복·상한 초과는 무시
        if (duplicateAt !== -1 || members.length >= MAX_SLOT_KEYS) return;
        // 단일 상태에서 키가 늘면 개별 판정으로 승격
        const nextMode = slotMode === 'single' ? 'any' : slotMode;
        if (nextMode !== slotMode) setSlotMode(nextMode);
        commitMembers([...members, captured], nextMode);
      }
    },
  });

  if (mappingControlLayout) {
    return <PropertySection>{mappingControlLayout}</PropertySection>;
  }
  if (mappingControl) {
    return (
      <PropertySection>
        <PropertyRow
          label={mappingLabel || t('propertiesPanel.keyMapping') || '키 매핑'}
        >
          {mappingControl}
        </PropertyRow>
      </PropertySection>
    );
  }
  if (!slotEditable) return null;

  return (
    <PropertySection>
      <PropertyRow label={t('propertiesPanel.keyMapping') || '키 매핑'}>
        <button
          onClick={() =>
            // 기존처럼 즉시 캡처 (멀티 슬롯이면 첫 키 교체)
            startSlotListen(members.length === 0 ? null : 0)
          }
          className={`flex items-center justify-center h-[23px] min-w-[0px] max-w-[120px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
            slotListening && !slotPickerOpen ? 'shadow-focus-ring' : ''
          } text-fg text-body`}
        >
          <span className="truncate">
            {slotListening && !slotPickerOpen
              ? t('propertiesPanel.pressAnyKey') || 'Press any key'
              : slotParts.label ||
                t('propertiesPanel.clickToSet') ||
                'Click to set'}
          </span>
          {!(slotListening && !slotPickerOpen) && slotParts.extra && (
            // case 피처: +를 숫자 중심에 맞춘 글리프로 치환.
            // tracking은 +와 숫자 사이 0.25px 확보용, 끝 글자 뒤 여분은 -mr로 상쇄 (배지는 한 자리 전제)
            <span className="pl-[3px] tracking-[0.25px] -mr-[0.25px] text-fg-faint [font-feature-settings:'case']">
              {slotParts.extra}
            </span>
          )}
        </button>
      </PropertyRow>

      <PropertyRow label={t('propertiesPanel.multiKey') || 'Mapping details'}>
        <button
          ref={slotEditButtonRef}
          onClick={() => setSlotPickerOpen((prev) => !prev)}
          className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
            slotPickerOpen ? 'shadow-focus-ring' : ''
          } text-fg text-body`}
        >
          {t('propertiesPanel.configure') || '설정하기'}
        </button>
      </PropertyRow>

      <KeySlotPicker
        open={slotPickerOpen}
        referenceRef={slotEditButtonRef}
        panelElement={panelElement}
        onClose={() => {
          setSlotPickerOpen(false);
          stopSlotListen();
        }}
        members={members}
        mode={slotMode}
        isListening={slotListening}
        listenIndex={slotListenIndex}
        onChipClick={(index) => startSlotListen(index)}
        onAddClick={() => startSlotListen(null)}
        onRemove={(index) => {
          // 진행 중 리스닝 취소 후 제거 (인덱스 밀림 방어)
          stopSlotListen();
          commitMembers(members.filter((_, i) => i !== index));
        }}
        onModeChange={handleSlotModeChange}
        labels={{
          title: t('propertiesPanel.multiKeyEdit') || 'Multi-key',
          modeAny: t('propertiesPanel.matchAny') || 'Individual',
          modeAll: t('propertiesPanel.matchAll') || 'Combined',
          pressAnyKey: t('propertiesPanel.pressAnyKey') || 'Press any key',
          addKey: t('propertiesPanel.addKey') || 'Add key',
          removeKey: t('propertiesPanel.removeKey') || 'Remove key',
        }}
      />
    </PropertySection>
  );
};

export default SingleMappingSection;
