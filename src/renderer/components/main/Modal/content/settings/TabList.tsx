import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useLenis } from '@hooks/useLenis';
import TabNameModal from '../editors/TabNameModal';
import { keysApi } from '@api/modules/keysApi';
import { buildOrderedTabs, builtinTabLabelKey } from '@utils/tabOrder';
import { useTabDrag } from '../../../Tool/tabDragContext';
import { useTabActions } from '../../../Tool/tabActionsContext';

const MAX_CUSTOM_TABS = 30;
const VISIBLE_TAB_COUNT = 7;
const TAB_ROW_HEIGHT = 26;
const TAB_ROW_GAP = 4;
const TAB_LIST_MAX_HEIGHT =
  VISIBLE_TAB_COUNT * TAB_ROW_HEIGHT + (VISIBLE_TAB_COUNT - 1) * TAB_ROW_GAP;

const TabList = () => {
  const customTabs = useKeyStore((state) => state.customTabs) ?? [];
  const tabOrder = useKeyStore((state) => state.tabOrder);
  const barCount = useKeyStore((state) => state.barCount);
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  const { requestRename, requestDelete } = useTabActions();
  const { t } = useTranslation();

  const [showNameModal, setShowNameModal] = useState(false);

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  const maxReached = customTabs.length >= MAX_CUSTOM_TABS;
  // 바에 나와 있는 탭은 여기 안 그린다. 같은 탭이 두 군데 보일 이유가 없다.
  // 바에 올린 탭의 이름 변경·삭제는 칩 우클릭이 맡는다
  const overflowTabs = buildOrderedTabs(tabOrder, customTabs, (id) =>
    t(builtinTabLabelKey(id)),
  ).slice(barCount);
  const { registerZone } = useTabDrag();
  // 드롭 영역과 스크롤 컨테이너가 같은 노드다. 목록 바깥(탭 만들기 행)까지 영역에
  // 넣으면 거기 있어도 마지막 행이 켜진다 - 영역은 행이 실제로 놓인 데까지만
  const registerOverflowZone = registerZone('overflow');
  const listRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef(element);
      registerOverflowZone(element);
    },
    [scrollRef, registerOverflowZone],
  );

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [overflowTabs.length, lenisInstance]);

  const handleCreate = async (name: string) => {
    const result = await keysApi.customTabs.create(name);
    return result;
  };

  const handleSelect = (id: string) => {
    if (selectedKeyType === id) return;
    // 공통 mode action이 즉시 표시·generation·실패 재동기화를 담당한다.
    // custom_tabs_select 후 setMode를 다시 호출하던 중복 IPC 경로 제거.
    setSelectedKeyType(id);
  };

  return (
    // 표면 클래스는 TabTool이 소유 - 여기서는 내용만 낸다
    <>
      {/* 탭 목록 - 드롭다운 메뉴와 같은 플랫 행 문법, 팝업 표면에 바로 배치.
          추가는 목록이 할 수 있는 일이라 같은 행 리듬을 쓴다 - 바깥 래퍼가 4px 간격을 소유 */}
      <div className="flex flex-col w-full gap-[4px]">
        {/* 페이드는 스크롤이 실제로 생길 때만 건다. scroll(self) 타임라인이 비활성일 때
            fill: both 가 0% 키프레임을 채워 짧은 목록에서도 마지막 행이 흐려진다 */}
        {/* 목록이 비면 아예 그리지 않는다. 높이 0이어도 부모의 갭은 그대로 먹어서
            위쪽 여백만 4px 두꺼워진다 */}
        {/* px/-mx 5px는 착지 스쿼시가 설 자리다. 이 컨테이너는 contain: paint라
            행 폭이 컨테이너 폭과 같으면 1.018배 오버슛이 양옆에서 잘린다.
            w-full 대신 stretch에 맡겨야 음수 마진만큼 실제로 넓어진다 */}
        {overflowTabs.length > 0 && (
          <div
            ref={listRef}
            className={`flex flex-col gap-[4px] px-[5px] -mx-[5px] overflow-y-auto modal-content-scroll ${
              overflowTabs.length > VISIBLE_TAB_COUNT ? 'dmn-scroll-fade' : ''
            }`}
            style={{ maxHeight: `${TAB_LIST_MAX_HEIGHT}px` }}
          >
            {overflowTabs.map((tab) => (
              <TabRow
                key={tab.id}
                id={tab.id}
                name={tab.name}
                isBuiltin={tab.isBuiltin}
                isSelected={selectedKeyType === tab.id}
                onSelect={() => handleSelect(tab.id)}
                onRename={() => requestRename({ id: tab.id, name: tab.name })}
                onDelete={() => requestDelete({ id: tab.id, name: tab.name })}
              />
            ))}
          </div>
        )}

        {/* 선행 글리프가 이 행을 탭이 아니라 동작으로 구분한다 - 라벨이 탭 이름 줄에서
            비켜나는 것도 같은 이유 */}
        {!maxReached && (
          <button
            type="button"
            onClick={() => setShowNameModal(true)}
            className="w-full h-[26px] shrink-0 flex items-center gap-[6px] px-[8px] rounded-md text-body text-fg-muted hover:bg-fill hover:text-fg transition-colors duration-fast"
          >
            {/* 마크 7px, 굵기 1.2 - 서브메뉴 화살표, 삭제 x와 같은 무게 */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="shrink-0"
              aria-hidden="true"
            >
              <path
                d="M5 1.5V8.5M1.5 5H8.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span className="min-w-0 truncate">{t('tabs.createTitle')}</span>
          </button>
        )}
      </div>

      <TabNameModal
        isOpen={showNameModal}
        onClose={() => setShowNameModal(false)}
        onSubmit={handleCreate}
        existingNames={customTabs.map((tab) => tab.name)}
      />
    </>
  );
};

interface TabRowProps {
  id: string;
  name: string;
  isBuiltin: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const TabRow = ({
  id,
  name,
  isBuiltin,
  isSelected,
  onSelect,
  onRename,
  onDelete,
}: TabRowProps) => {
  const { t } = useTranslation();
  const { draggingId, landedId, swapTargetId, beginDrag, registerTarget } =
    useTabDrag();
  const isDragging = draggingId === id;

  return (
    // 인터랙티브 요소 중첩 금지 — 행 래퍼는 비인터랙티브,
    // 선택은 행 전체를 덮는 스트레치드 버튼, 이름 변경·삭제는 형제 button
    <div
      ref={registerTarget(id, 'vertical')}
      data-dragging={isDragging ? 'true' : undefined}
      className={`dmn-tab-chip group relative w-full h-[26px] shrink-0 flex items-center px-[8px] rounded-md text-body cursor-pointer ${
        isSelected
          ? 'bg-fill-hover text-fg'
          : 'text-fg-muted hover:bg-fill hover:text-fg'
      } ${landedId === id ? 'dmn-tab-landed' : ''} ${
        swapTargetId === id ? 'dmn-tab-swap-target' : ''
      }`}
      onPointerDown={(event) => beginDrag(id, event)}
    >
      <button
        type="button"
        aria-label={name}
        aria-current={isSelected || undefined}
        className="absolute inset-0 rounded-md"
        onClick={onSelect}
      />
      <span className="relative flex-1 min-w-0 truncate text-left pointer-events-none">
        {name}
      </span>
      {!isBuiltin && (
        <>
          <button
            type="button"
            aria-label={t('tabs.renameTitle')}
            data-tab-action="true"
            className="relative flex items-center justify-center h-full w-[20px] shrink-0 text-fg-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-fg"
            onClick={onRename}
          >
            {/* 연필 - 삭제 x, 추가 + 와 같은 굵기 1.2 */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6.8 1.5 8.5 3.2M1.5 8.5l.5-2 4.6-4.6a.7.7 0 0 1 1 0l.5.5a.7.7 0 0 1 0 1L3.5 8l-2 .5Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label={t('tabs.delete')}
            data-tab-action="true"
            className="relative flex items-center justify-center h-full w-[20px] -mr-[6px] shrink-0 text-label leading-none text-fg-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-fg"
            onClick={onDelete}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
};

export default TabList;
