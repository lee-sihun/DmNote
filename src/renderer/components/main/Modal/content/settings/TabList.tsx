import { useEffect, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import TrashIcon from '@assets/svgs/trash.svg';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useLenis } from '@hooks/useLenis';
import SearchField from '@components/main/common/SearchField';
import AddIconButton from '@components/main/common/AddIconButton';
import Alert from '../dialogs/Alert.jsx';
import TabNameModal from '../editors/TabNameModal';

const MAX_CUSTOM_TABS = 30;
const VISIBLE_TAB_COUNT = 5;
const TAB_ROW_HEIGHT = 28;
const TAB_ROW_GAP = 4;
const TAB_LIST_MAX_HEIGHT =
  VISIBLE_TAB_COUNT * TAB_ROW_HEIGHT + (VISIBLE_TAB_COUNT - 1) * TAB_ROW_GAP;

const TabList = () => {
  const customTabs = useKeyStore((state) => state.customTabs) ?? [];
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  const { t } = useTranslation();

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [query, setQuery] = useState('');

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  const maxReached = customTabs.length >= MAX_CUSTOM_TABS;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTabs = normalizedQuery
    ? customTabs.filter((tab) =>
        tab.name.toLowerCase().includes(normalizedQuery),
      )
    : customTabs;

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [visibleTabs.length, lenisInstance]);

  const handleCreate = async (name: string) => {
    const result = await window.api.keys.customTabs.create(name);
    return result;
  };

  const handleSelect = async (id: string) => {
    try {
      const result = await window.api.keys.customTabs.select(id);
      if (result?.success) {
        setSelectedKeyType(result.selected);
      }
      return result;
    } catch (error) {
      console.error('Failed to select custom tab', error);
      return { success: false };
    }
  };

  // 탭 삭제는 의도적으로 Undo 경계를 만들지 않음 — 확인창이 방어선 (1.2.x부터)
  // 다른 편집의 Undo 스냅샷에는 탭이 포함돼 결합 복원됨 (1.6.0부터) — 기록 누락 버그로 오판 금지
  const handleDelete = async (id: string) => {
    try {
      const result = await window.api.keys.customTabs.delete(id);
      if (!result?.success) {
        console.warn('Failed to delete custom tab', result?.error);
      }
    } catch (error) {
      console.error('Failed to delete custom tab', error);
    }
  };

  return (
    <div className="flex flex-col gap-[6px] w-[216px] p-[8px] bg-glass backdrop-glass-popup rounded-popup shadow-elevation-2">
      {/* 그룹 카드, 동심 라운딩: 카드 10 = 행 6 + 패딩 4 */}
      {customTabs.length > 0 && (
        <div className="bg-fill-faint rounded-surface p-[4px] flex flex-col">
          <div
            ref={scrollRef}
            className="flex flex-col w-full gap-[4px] overflow-y-auto modal-content-scroll dmn-scroll-fade"
            style={{ maxHeight: `${TAB_LIST_MAX_HEIGHT}px` }}
          >
            {visibleTabs
              .slice()
              .reverse()
              .map((tab) => {
                const isSelected = selectedKeyType === tab.id;
                // 인터랙티브 요소 중첩 금지 — 행 래퍼는 비인터랙티브,
                // 선택은 행 전체를 덮는 스트레치드 버튼, 삭제는 형제 button
                return (
                  <div
                    key={tab.id}
                    className={`group relative w-full h-[28px] shrink-0 flex items-center gap-[4px] px-[8px] rounded-md text-body cursor-pointer transition-colors duration-fast ${
                      isSelected
                        ? 'bg-accent-muted text-fg'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
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
                      className="relative w-[18px] h-[18px] -mr-[4px] shrink-0 flex items-center justify-center rounded-[4px] text-fg-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-danger-fg transition-all duration-fast"
                      onClick={() =>
                        setDeleteTarget({ id: tab.id, name: tab.name })
                      }
                    >
                      <TrashIcon className="w-[10px] h-[11px]" />
                    </button>
                  </div>
                );
              })}

            {/* 검색 결과 없음 */}
            {normalizedQuery && visibleTabs.length === 0 && (
              <div className="h-[28px] shrink-0 flex items-center px-[8px] text-body text-fg-faint select-none">
                {t('tabs.search.empty')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 하단 컨트롤 행: 앵커(그리드 버튼) 쪽 고정, 목록이 위로 자라도 위치 불변 */}
      <div className="flex items-center gap-[6px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('tabs.search.placeholder')}
          className="flex-1 min-w-0"
        />
        {!maxReached && (
          <AddIconButton
            label={t('tabs.createTitle')}
            onClick={() => setShowNameModal(true)}
            className="ml-auto"
          />
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
    </div>
  );
};

export default TabList;
