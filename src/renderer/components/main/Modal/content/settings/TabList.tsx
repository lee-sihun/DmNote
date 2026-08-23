import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useLenis } from '@hooks/useLenis';
import Alert from '../dialogs/Alert.jsx';
import TabNameModal from '../editors/TabNameModal';
import { keysApi } from '@api/modules/keysApi';

const MAX_CUSTOM_TABS = 30;
const VISIBLE_TAB_COUNT = 5;
const TAB_ROW_HEIGHT = 26;
const TAB_ROW_GAP = 4;
const TAB_LIST_MAX_HEIGHT =
  VISIBLE_TAB_COUNT * TAB_ROW_HEIGHT + (VISIBLE_TAB_COUNT - 1) * TAB_ROW_GAP;

const TabList = () => {
  const customTabs = useKeyStore((state) => state.customTabs) ?? [];
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  const setCustomTabs = useKeyStore((state) => state.setCustomTabs);
  const { t } = useTranslation();

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const deletingTabsRef = useRef(new Set<string>());

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  const maxReached = customTabs.length >= MAX_CUSTOM_TABS;

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [customTabs.length, lenisInstance]);

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

  // 탭 삭제는 의도적으로 Undo 경계를 만들지 않음 — 확인창이 방어선 (1.2.x부터)
  // 다른 편집의 Undo 스냅샷에는 탭이 포함돼 결합 복원됨 (1.6.0부터) — 기록 누락 버그로 오판 금지
  const handleDelete = async (id: string) => {
    if (deletingTabsRef.current.has(id)) return;
    deletingTabsRef.current.add(id);
    const previousTabs = useKeyStore.getState().customTabs;
    setCustomTabs(previousTabs.filter((tab) => tab.id !== id));
    try {
      const result = await keysApi.customTabs.delete(id);
      if (!result?.success) {
        console.warn('Failed to delete custom tab', result?.error);
        setCustomTabs(previousTabs);
      } else {
        useKeyStore.setState({ selectedKeyType: result.selected });
      }
    } catch (error) {
      setCustomTabs(previousTabs);
      console.error('Failed to delete custom tab', error);
    } finally {
      deletingTabsRef.current.delete(id);
    }
  };

  return (
    // 표면 클래스는 TabTool이 소유 - 여기서는 내용만 낸다
    <>
      {/* 탭 리스트 - 드롭다운 메뉴와 같은 플랫 행 문법, 팝업 표면에 바로 배치.
          추가는 목록이 할 수 있는 일이라 같은 행 리듬을 쓴다 - 바깥 래퍼가 4px 간격을 소유 */}
      <div className="flex flex-col w-full gap-[4px]">
        {customTabs.length > 0 && (
          <div
            ref={scrollRef}
            className="flex flex-col w-full gap-[4px] overflow-y-auto modal-content-scroll dmn-scroll-fade"
            style={{ maxHeight: `${TAB_LIST_MAX_HEIGHT}px` }}
          >
            {customTabs
              .slice()
              .reverse()
              .map((tab) => {
                const isSelected = selectedKeyType === tab.id;
                // 인터랙티브 요소 중첩 금지 — 행 래퍼는 비인터랙티브,
                // 선택은 행 전체를 덮는 스트레치드 버튼, 삭제는 형제 button
                return (
                  <div
                    key={tab.id}
                    className={`group relative w-full h-[26px] shrink-0 flex items-center px-[8px] rounded-md text-body cursor-pointer transition-colors duration-fast ${
                      isSelected
                        ? 'bg-accent-muted text-fg'
                        : 'text-fg-muted hover:bg-fill hover:text-fg'
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={tab.name}
                      aria-current={isSelected || undefined}
                      className="absolute inset-0 rounded-md"
                      onClick={() => handleSelect(tab.id)}
                    />
                    <span className="relative flex-1 min-w-0 truncate text-left pointer-events-none">
                      {tab.name}
                    </span>
                    <button
                      type="button"
                      aria-label={t('tabs.delete')}
                      className="relative flex items-center justify-center h-full w-[20px] -mr-[6px] shrink-0 text-label leading-none text-fg-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-fg transition-opacity duration-fast"
                      onClick={() =>
                        setDeleteTarget({ id: tab.id, name: tab.name })
                      }
                    >
                      ×
                    </button>
                  </div>
                );
              })}
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
        existingNames={customTabs.map((t) => t.name)}
      />

      <Alert
        isOpen={deleteTarget !== null}
        type="confirm"
        message={t('tabs.deleteConfirm', { name: deleteTarget?.name || '' })}
        confirmText={t('tabs.delete')}
        cancelText={t('common.cancel')}
        showCancel
        onConfirm={async () => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          // 확인창이 열린 사이 목록이 교체될 수 있음 (프리셋 로드 등)
          // id·이름이 모두 현재 목록과 일치할 때만 삭제
          const current = customTabs.find((tab) => tab.id === target.id);
          if (current && current.name === target.name) {
            await handleDelete(target.id);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
};

export default TabList;
