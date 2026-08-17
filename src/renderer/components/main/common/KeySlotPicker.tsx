import React, { useCallback } from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/PickerSurface';
import TabSwitch from '@components/main/common/TabSwitch';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { MAX_SLOT_KEYS } from '@utils/keySlot';
import type { KeySlotUiMode } from '@utils/keySlot';

interface KeySlotPickerLabels {
  title: string;
  modeAny: string;
  modeAll: string;
  pressAnyKey: string;
  addKey: string;
  removeKey: string;
}

interface KeySlotPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement | null>;
  panelElement?: HTMLElement | null;
  // 스크롤·contain 조상 안에서 열릴 때 필요 - 인라인이면 그 박스에 잘린다
  portalToBody?: boolean;
  onClose: () => void;
  members: string[];
  mode: KeySlotUiMode;
  isListening: boolean;
  listenIndex: number | null;
  onChipClick: (index: number) => void;
  onAddClick: () => void;
  onRemove: (index: number) => void;
  onModeChange: (mode: KeySlotUiMode) => void;
  labels: KeySlotPickerLabels;
}

// 멀티 키 매핑 편집 팝업 - ImagePicker와 같은 피커 표면 문법 사용
const KeySlotPicker = ({
  open,
  referenceRef,
  panelElement = null,
  portalToBody = false,
  onClose,
  members,
  mode,
  isListening,
  listenIndex,
  onChipClick,
  onAddClick,
  onRemove,
  onModeChange,
  labels,
}: KeySlotPickerProps) => {
  // 캡처 대기 행이 스크롤 밖이면 보이는 위치로
  const listeningRowRef = useCallback((node: HTMLElement | null) => {
    node?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <PickerSurface
      open={open}
      ariaLabel={labels.title}
      referenceRef={referenceRef as React.RefObject<HTMLElement>}
      panelElement={panelElement}
      portalToBody={portalToBody}
      fallbackWidth={172}
      fallbackHeight={150}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] bg-glass-heavy backdrop-glass rounded-popup shadow-elevation-3"
      onClose={onClose}
    >
      {/* 판정 방식 - 개별(any) / 동시(all), 키 2개부터 의미가 생김 */}
      {members.length >= 2 && (
        <TabSwitch
          commitStrategy="after-paint"
          tabs={[
            { id: 'any', label: labels.modeAny },
            { id: 'all', label: labels.modeAll },
          ]}
          activeTab={mode === 'all' ? 'all' : 'any'}
          onTabChange={(tab) => onModeChange(tab as KeySlotUiMode)}
        />
      )}

      {/* 멤버 키 리스트 - 드롭다운 메뉴와 같은 플랫 행 문법, 클릭 시 재캡처.
          6행 초과부터 내부 스크롤로 팝업 높이 고정 */}
      <div className="flex flex-col gap-[4px] max-h-[158px] overflow-y-auto">
        {members.map((member, index) => (
          <div
            key={`${member}-${index}`}
            ref={
              isListening && listenIndex === index ? listeningRowRef : undefined
            }
            className={`group flex items-center shrink-0 h-[23px] rounded-md transition-colors duration-fast ${
              isListening && listenIndex === index
                ? 'bg-surface-active'
                : 'hover:bg-surface-hover'
            }`}
          >
            <button
              onClick={() => onChipClick(index)}
              className="flex-1 min-w-0 flex items-center h-full px-[8px] text-left text-body text-fg"
            >
              <span className="truncate">
                {isListening && listenIndex === index
                  ? labels.pressAnyKey
                  : getKeyInfoByGlobalKey(member).displayName}
              </span>
            </button>
            {members.length > 1 && (
              <button
                onClick={() => onRemove(index)}
                aria-label={labels.removeKey}
                className="flex items-center justify-center h-full w-[20px] shrink-0 opacity-0 group-hover:opacity-100 text-fg-muted hover:text-fg transition-opacity duration-fast text-body"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {/* 추가 행 - 캡처 대기 시 같은 자리에서 문구만 교체되어 레이아웃 점프 없음 */}
        {members.length < MAX_SLOT_KEYS && (
          <button
            onClick={onAddClick}
            aria-label={labels.addKey}
            ref={
              isListening && listenIndex === null ? listeningRowRef : undefined
            }
            className={`flex items-center shrink-0 h-[23px] px-[8px] rounded-md text-body text-left transition-colors duration-fast ${
              isListening && listenIndex === null
                ? 'bg-surface-active text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            }`}
          >
            <span className="truncate">
              {isListening && listenIndex === null
                ? labels.pressAnyKey
                : `+ ${labels.addKey}`}
            </span>
          </button>
        )}
      </div>
    </PickerSurface>
  );
};

export default KeySlotPicker;
