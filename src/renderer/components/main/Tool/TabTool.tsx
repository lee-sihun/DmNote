import { useKeyStore } from '@stores/data/useKeyStore';
import TabGridIcon from './icons/TabGridIcon';
import { useTranslation } from '@contexts/useTranslation';
import { useIconMotion } from '@hooks/useIconMotion';
import { useEffect, useState, useRef } from 'react';
import FloatingPopup from '../Modal/FloatingPopup';
import { CANVAS_POPUP_CHROME_CLASS } from '../Modal/popupChrome';
import TabList from '../Modal/content/settings/TabList';
import FloatingTooltip from '../Modal/FloatingTooltip';
import { TooltipGroup } from '../Modal/TooltipGroup';
import { buildOrderedTabs, builtinTabLabelKey } from '@utils/tabOrder';
import ListPopup from '../Modal/ListPopup';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import { TabDragProvider } from './tabDrag';
import { useTabDrag } from './tabDragContext';
import { TabActionsProvider } from './tabActions';
import { useTabActions } from './tabActionsContext';

const TabTool = () => {
  // 팝업 상태는 Provider보다 위에 둔다. 잡은 채 그리드 버튼에 머물면 세션이 팝업을 연다
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  return (
    // 이름·삭제 모달은 팝업 바깥에서 소유한다. 팝업 안에 두면 닫히는 순간
    // 같이 사라지고, 바 칩은 팝업이 닫힌 채로도 눌린다
    <TabActionsProvider>
      <TabDragProvider onRequestOpenPopup={() => setIsPopupOpen(true)}>
        <TabToolContent isOpen={isPopupOpen} setIsOpen={setIsPopupOpen} />
      </TabDragProvider>
    </TabActionsProvider>
  );
};

interface TabToolContentProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const TabToolContent = ({ isOpen, setIsOpen }: TabToolContentProps) => {
  const { t } = useTranslation();
  const { registerZone, isOverOpener } = useTabDrag();
  const { selectedKeyType, setSelectedKeyType, isBootstrapped } = useKeyStore();
  const customTabs = useKeyStore((state) => state.customTabs);
  const tabOrder = useKeyStore((state) => state.tabOrder);
  const barCount = useKeyStore((state) => state.barCount);
  const gridButtonRef = useRef(null);
  const { motionProps } = useIconMotion();
  const { requestRename, requestDelete } = useTabActions();
  // 바에 올린 커스텀 탭은 팝업 목록에 없다. 이름 변경과 삭제는 여기가 유일한 창구다
  const menu = usePickerItemMenu<string>();
  const { close: closeMenu, menuKey } = menu;

  const orderedTabs = buildOrderedTabs(tabOrder, customTabs, (id) =>
    t(builtinTabLabelKey(id)),
  );
  const barTabs = orderedTabs.slice(0, barCount);
  // 퇴장 모션이 도는 동안에도 대상이 필요하다 - renderKey로 찾는다
  const menuTab = orderedTabs.find((tab) => tab.id === menu.renderKey);

  useEffect(() => {
    if (menuKey === null || menuTab) return;
    closeMenu();
  }, [closeMenu, menuKey, menuTab]);

  return (
    <div className="flex gap-[8px] min-w-0">
      {/* 창이 902px 고정이라 이름이 길면 바가 예산을 넘는다. flex 축소가 기본 크기에
          비례해 줄이므로 짧은 이름은 거의 그대로 남고 긴 이름이 먼저 잘린다 */}
      {/* TooltipGroup은 컨텍스트만 주는 게 아니라 div를 하나 그린다. 그게 진짜
          flex 아이템이라 축소 허용이 여기 있어야 한다 - 안쪽 바에만 붙이면
          부모가 안 줄어들어 긴 이름이 툴바 밖으로 삐져나간다 */}
      <TooltipGroup className="min-w-0">
        {/* 칸 사이 빈 자리에 놓아도 바의 끝으로 들어간다 */}
        <div
          ref={registerZone('bar')}
          className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface gap-[4px] min-w-0"
        >
          {barTabs.map((tab) => (
            <TabButton
              key={tab.id}
              id={tab.id}
              text={tab.name}
              isSelected={selectedKeyType === tab.id}
              disabled={!isBootstrapped}
              // 내장 탭은 이름도 못 바꾸고 지울 수도 없어서 메뉴를 열지 않는다
              onContextMenu={
                tab.isBuiltin
                  ? undefined
                  : (event) => menu.openFromContextMenu(event, tab.id)
              }
              onMenuKey={
                tab.isBuiltin
                  ? undefined
                  : (event) => menu.openFromKeyboard(event, tab.id)
              }
              onClick={() => {
                if (!isBootstrapped) return;
                setSelectedKeyType(tab.id);
                // 바 칩 선택 시 탭 목록 닫기
                setIsOpen(false);
              }}
            />
          ))}
        </div>
      </TooltipGroup>
      <button
        ref={gridButtonRef}
        className="flex items-center justify-center w-[40px] h-[40px] p-[5px] bg-fill-faint rounded-surface shrink-0"
        onClick={() => {
          if (!isBootstrapped) return;
          setIsOpen(!isOpen);
        }}
        disabled={!isBootstrapped}
        {...motionProps}
      >
        {/* 필은 열려 있다는 뜻이다. 팝업이 떠 있는 동안, 그리고 잡은 채 여기
            머물러 곧 열릴 때만 칠한다. 그 밖에는 툴바의 다른 아이콘과 같은 색이다 */}
        <div
          ref={registerZone('opener')}
          className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors duration-fast ${
            isOpen || isOverOpener
              ? 'bg-fill-hover text-fg'
              : 'text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover'
          } ${!isBootstrapped ? 'opacity-40' : ''}`}
        >
          <TabGridIcon />
        </div>
      </button>
      <FloatingPopup
        // TabList가 자기 흐름에서 이름·삭제 모달을 연다 - 덮임 자동 닫힘이 그 모달까지
        // 언마운트한다. 이 팝업은 툴바 서브트리 안(z 40 < 모달 50)이라 잠금 시 inert·딤
        // 처리되므로 유령이 되지 않는다 (PickerSurface와 같은 근거)
        closeOnModalCover={false}
        open={isOpen && isBootstrapped}
        ariaLabel={t('tabs.title')}
        referenceRef={gridButtonRef}
        placement="bottom"
        initialFocus="surface"
        onClose={() => setIsOpen(false)}
        contentMountStrategy="after-paint"
        // 글래스와 모션은 팝업 표면이 소유 - ListPopup과 같은 구조.
        // 담는 것이 메뉴 행뿐이라 표면도 메뉴 계열을 그대로 쓴다.
        // 패딩 5px = 갭 4px + inset 링 1px 보정 - 링이 패딩 최외곽을 덮어
        // 같은 값이면 가장자리만 1px 좁아 보인다
        className={`dmn-motion flex flex-col gap-[4px] w-[180px] p-[5px] ${CANVAS_POPUP_CHROME_CLASS} rounded-surface`}
      >
        <TabList />
      </FloatingPopup>

      {menu.renderKey !== null && (
        <ListPopup
          open={menu.menuKey !== null}
          ariaLabel={t('common.more')}
          position={menu.renderPosition ?? undefined}
          onClose={menu.close}
          items={[
            // tabs.rename은 모달 확인 버튼 문구다 - 한국어가 "변경하기"라 메뉴에 안 맞는다.
            // 연필 버튼의 접근성 이름과 같은 키를 쓴다
            { id: 'rename', label: t('tabs.renameTitle') },
            { id: 'delete', label: t('tabs.delete') },
          ]}
          onSelect={(id) => {
            const target = menuTab;
            menu.close();
            if (!target) return;
            // 창구 계약은 id와 이름뿐이다. 목록 항목을 통째로 넘기지 않는다
            const request = { id: target.id, name: target.name };
            if (id === 'rename') requestRename(request);
            if (id === 'delete') requestDelete(request);
          }}
          offsetX={0}
          offsetY={0}
        />
      )}
    </div>
  );
};

interface TabButtonProps {
  id: string;
  text: string;
  isSelected?: boolean;
  onClick?: () => void;
  /** 없으면 이 칩은 메뉴를 열지 않는다 (내장 탭) */
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  onMenuKey?: (event: React.KeyboardEvent<HTMLElement>) => void;
  disabled?: boolean;
}

const TabButton = ({
  id,
  text,
  isSelected = false,
  onClick,
  onContextMenu,
  onMenuKey,
  disabled,
}: TabButtonProps) => {
  const { draggingId, landedId, swapTargetId, beginDrag, registerTarget } =
    useTabDrag();
  const labelRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const isDragging = draggingId === id;

  return (
    // 축소 규칙은 툴팁 래퍼가 진짜 flex 아이템이라 그쪽이 가져야 한다.
    // 버튼에 두면 래퍼만 줄어들어 선택된 칩이 이웃 위로 삐져나온다
    <FloatingTooltip
      content={text}
      disabled={!isTruncated || !!draggingId}
      className={`min-w-0 ${isSelected ? 'shrink-0' : ''}`}
    >
      <button
        ref={registerTarget(id, 'horizontal')}
        type="button"
        data-dragging={isDragging ? 'true' : undefined}
        // 선택된 탭은 축소 대상에서 빼 이름을 끝까지 보여준다 - 지금 보고 있는 탭이
        // 잘리면 어디 있는지 알 수 없다.
        // 색 전이는 .dmn-tab-chip이 소유한다 - 여기 transition-colors를 붙여도 덮인다
        className={`dmn-tab-chip flex items-center h-[30px] px-[10px] rounded-md min-w-0 ${
          isSelected
            ? 'bg-fill-hover text-fg'
            : 'text-fg-muted hover:bg-fill hover:text-fg'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${
          landedId === id ? 'dmn-tab-landed' : ''
        } ${swapTargetId === id ? 'dmn-tab-swap-target' : ''}`}
        onPointerDown={(event) => {
          if (disabled) return;
          beginDrag(id, event);
        }}
        // 잘렸을 때만 툴팁을 띄운다 - 다 보이는데 툴팁이 뜨면 성가시다.
        // 폭이 선택에 따라 재배분되므로 렌더가 아니라 호버 시점에 잰다
        onPointerEnter={() => {
          const el = labelRef.current;
          if (el) setIsTruncated(el.scrollWidth > el.clientWidth + 1);
        }}
        onClick={() => onClick?.()}
        onContextMenu={onContextMenu}
        // 키보드로도 같은 메뉴를 연다. Enter·Space는 탭 선택이 가져가므로
        // OS 표준인 컨텍스트 메뉴 키와 Shift+F10을 쓴다
        onKeyDown={(event) => {
          if (!onMenuKey) return;
          const isMenuKey =
            event.key === 'ContextMenu' ||
            (event.key === 'F10' && event.shiftKey);
          if (isMenuKey) onMenuKey(event);
        }}
        disabled={disabled}
      >
        <span ref={labelRef} className="text-label truncate">
          {text}
        </span>
      </button>
    </FloatingTooltip>
  );
};

export default TabTool;
