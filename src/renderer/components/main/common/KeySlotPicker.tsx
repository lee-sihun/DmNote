import React, { useCallback } from 'react';
import PickerSurface from '@components/main/Grid/PropertiesPanel/controls/PickerSurface';
import TabSwitch from '@components/main/common/TabSwitch';
import ListAddRow from '@components/main/common/ListAddRow';
import { getKeyInfoByGlobalKey } from '@utils/input/KeyMaps';
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
      fallbackWidth={172}
      fallbackHeight={160}
      cardClassName="flex flex-col p-[8px] gap-[8px] w-[172px] rounded-popup"
      onClose={onClose}
    >
      {/* 판정 방식 - 개별(any) / 동시(all), 키 2개부터 의미가 생기므로 그 전엔 비활성.
          상시 노출로 키 추가 시 레이아웃 점프 없음 */}
      <TabSwitch
        commitStrategy="after-paint"
        disabled={members.length < 2}
        tabs={[
          { id: 'any', label: labels.modeAny },
          { id: 'all', label: labels.modeAll },
        ]}
        activeTab={mode === 'all' ? 'all' : 'any'}
        onTabChange={(tab) => onModeChange(tab as KeySlotUiMode)}
      />

      {/* 멤버 키 리스트 - 설정 행과 같은 섹션 면 위에 플랫 행 문법, 클릭 시 재캡처.
          스크롤은 안쪽 래퍼 소유 - 바깥에 두면 모서리 클리핑이 깨짐.
          6행 초과부터 내부 스크롤로 팝업 높이 고정 */}
      <div className="bg-fill-faint rounded-surface p-[4px]">
        <div className="flex flex-col gap-[4px] max-h-[158px] overflow-y-auto">
          {members.map((member, index) => (
            <div
              key={`${member}-${index}`}
              ref={
                isListening && listenIndex === index
                  ? listeningRowRef
                  : undefined
              }
              className={`group flex items-center shrink-0 h-[23px] rounded-md transition-colors duration-fast ${
                isListening && listenIndex === index
                  ? 'bg-fill-hover'
                  : 'hover:bg-fill'
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
            <ListAddRow
              size="sm"
              label={labels.addKey}
              activeLabel={labels.pressAnyKey}
              active={isListening && listenIndex === null}
              buttonRef={
                isListening && listenIndex === null
                  ? listeningRowRef
                  : undefined
              }
              onClick={onAddClick}
            />
          )}
        </div>
      </div>
    </PickerSurface>
  );
};

export default KeySlotPicker;
