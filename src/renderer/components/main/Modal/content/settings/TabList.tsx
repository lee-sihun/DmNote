import { useEffect, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import PlusIcon from '@assets/svgs/plus2.svg';
import TrashIcon from '@assets/svgs/trash.svg';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useLenis } from '@hooks/useLenis';
import Alert from '../dialogs/Alert.jsx';
import TabNameModal from '../editors/TabNameModal';

interface TabListProps {
  onClose?: () => void;
}

const MAX_CUSTOM_TABS = 30;
const VISIBLE_TAB_COUNT = 5;
const TAB_ITEM_HEIGHT = 26;
const TAB_ITEM_GAP = 4;
const TAB_LIST_MAX_HEIGHT =
  VISIBLE_TAB_COUNT * TAB_ITEM_HEIGHT + (VISIBLE_TAB_COUNT - 1) * TAB_ITEM_GAP;

const TabList = ({ onClose: _onClose }: TabListProps) => {
  const customTabs = useKeyStore((state) => state.customTabs) ?? [];
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  const { t } = useTranslation();

  const [askDelete, setAskDelete] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);

  const { scrollContainerRef: scrollRef, lenisInstance } = useLenis();

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [customTabs.length, lenisInstance]);

  const maxReached =
    Array.isArray(customTabs) && customTabs.length >= MAX_CUSTOM_TABS;

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

  const handleDelete = async () => {
    try {
      const result = await window.api.keys.customTabs.delete(selectedKeyType);
      if (!result?.success) {
        console.warn('Failed to delete custom tab', result?.error);
      }
    } catch (error) {
      console.error('Failed to delete custom tab', error);
    }
  };

  return (
    <div className="flex flex-col w-[184px] p-[4px] bg-glass backdrop-glass-popup rounded-surface shadow-elevation-2">
      {customTabs.length > 0 && (
        <>
          {/* 섹션 헤더 */}
          <div className="px-[8px] pt-[5px] pb-[6px] text-caption text-fg-faint select-none">
            {t('tabs.title')}
          </div>
          <div
            ref={scrollRef}
            className="flex flex-col w-full gap-[4px] overflow-y-auto modal-content-scroll dmn-scroll-fade"
            style={{ maxHeight: `${TAB_LIST_MAX_HEIGHT}px` }}
          >
            <div className="flex flex-col gap-[4px]">
              {[...customTabs]
                .slice()
                .reverse()
                .map((tab) => {
                  const isSelected = selectedKeyType === tab.id;
                  // 인터랙티브 요소 중첩 금지 — 행 래퍼는 비인터랙티브,
                  // 선택은 행 전체를 덮는 스트레치드 버튼, 삭제는 형제 button
                  return (
                    <div
                      key={tab.id}
                      className={`group relative w-full min-h-[26px] h-[26px] flex-shrink-0 flex items-center gap-[4px] px-[8px] rounded-md text-body cursor-pointer transition-colors duration-fast ${
                        isSelected
                          ? 'bg-surface-active text-fg'
                          : 'text-fg-muted hover:text-fg hover:bg-surface-hover active:bg-surface-active'
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={tab.name}
                        className="absolute inset-0 rounded-md"
                        onClick={() => handleSelect(tab.id)}
                      />
                      <span className="relative flex-1 min-w-0 truncate text-left pointer-events-none">
                        {tab.name}
                      </span>
                      {isSelected && (
                        <button
                          type="button"
                          title={t('tabs.delete')}
                          aria-label={t('tabs.delete')}
                          className="relative w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[4px] text-fg-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-danger hover:bg-danger-muted transition-all duration-fast"
                          onClick={() => setAskDelete(true)}
                        >
                          <TrashIcon className="w-[10px] h-[10px]" />
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {!maxReached && <div className="h-px bg-line my-[4px] -mx-[4px]" />}
        </>
      )}

      {!maxReached && (
        <button
          className="w-full h-[28px] rounded-md bg-fill hover:bg-fill-hover active:bg-fill-active flex items-center justify-center gap-[6px] text-fg transition-colors duration-fast"
          onClick={() => setShowNameModal(true)}
        >
          <PlusIcon className="w-[9px] h-[9px] shrink-0" />
          <span className="text-body">{t('tabs.createTitle')}</span>
        </button>
      )}

      <TabNameModal
        isOpen={showNameModal}
        onClose={() => setShowNameModal(false)}
        onSubmit={handleCreate}
        existingNames={customTabs.map((t) => t.name)}
      />

      <Alert
        isOpen={askDelete}
        type="confirm"
        message={t('tabs.deleteConfirm', {
          name: customTabs.find((t) => t.id === selectedKeyType)?.name || '',
        })}
        confirmText={t('tabs.delete')}
        cancelText={t('common.cancel')}
        showCancel
        onConfirm={async () => {
          setAskDelete(false);
          await handleDelete();
        }}
        onCancel={() => setAskDelete(false)}
      />
    </div>
  );
};

export default TabList;
