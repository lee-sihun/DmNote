/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import PlusIcon from '@assets/svgs/plus2.svg';
import MinusIcon from '@assets/svgs/minus.svg';
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
const TAB_ITEM_GAP = 2;
const SCROLL_CONTENT_GUTTER = 4;
const TAB_LIST_MAX_HEIGHT =
  VISIBLE_TAB_COUNT * TAB_ITEM_HEIGHT + (VISIBLE_TAB_COUNT - 1) * TAB_ITEM_GAP;

const TabList = ({ onClose: _onClose }: TabListProps) => {
  const customTabs = useKeyStore((state) => state.customTabs) ?? [];
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  const { t } = useTranslation();

  const [askDelete, setAskDelete] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const {
    scrollContainerRef: scrollRef,
    wrapperElement,
    lenisInstance,
    scrollbarWidth,
  } = useLenis();

  const isCustomSelected = !['4key', '5key', '6key', '8key'].includes(
    selectedKeyType,
  );

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [customTabs.length, lenisInstance]);

  useEffect(() => {
    const wrapper = wrapperElement;
    if (!wrapper) {
      setHasOverflow(false);
      return;
    }

    const updateOverflow = () => {
      const nextHasOverflow = wrapper.scrollHeight > wrapper.clientHeight;
      setHasOverflow((prev) =>
        prev === nextHasOverflow ? prev : nextHasOverflow,
      );
    };

    const rafId = requestAnimationFrame(updateOverflow);
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(wrapper);

    const contentEl = wrapper.firstElementChild;
    if (contentEl instanceof HTMLElement) {
      resizeObserver.observe(contentEl);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [wrapperElement, customTabs.length]);

  const maxReached =
    Array.isArray(customTabs) && customTabs.length >= MAX_CUSTOM_TABS;
  const scrollbarCompensation = hasOverflow
    ? scrollbarWidth + SCROLL_CONTENT_GUTTER
    : 0;

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
    <div className="flex flex-col w-[176px] p-[6px] bg-glass backdrop-blur-[24px] rounded-[12px] shadow-elevation-2">
      {customTabs.length === 0 ? (
        <div className="flex items-center justify-center py-[12px] text-caption text-fg-faint">
          {t('tabs.empty')}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex flex-col w-full gap-[2px] overflow-y-auto modal-content-scroll"
          style={{
            maxHeight: `${TAB_LIST_MAX_HEIGHT}px`,
            width:
              scrollbarCompensation > 0
                ? `calc(100% + ${scrollbarCompensation}px)`
                : undefined,
            marginRight:
              scrollbarCompensation > 0
                ? `-${scrollbarCompensation}px`
                : undefined,
          }}
        >
          <div
            className="flex flex-col gap-[2px]"
            style={
              hasOverflow
                ? { width: `calc(100% - ${SCROLL_CONTENT_GUTTER}px)` }
                : undefined
            }
          >
            {[...customTabs]
              .slice()
              .reverse()
              .map((tab) => (
                <button
                  key={tab.id}
                  className={`w-full min-h-[26px] h-[26px] flex-shrink-0 flex items-center px-[8px] rounded-[6px] text-body text-fg transition-colors duration-fast hover:bg-surface-hover active:bg-surface-active ${
                    selectedKeyType === tab.id ? 'bg-surface-active' : ''
                  }`}
                  onClick={() => handleSelect(tab.id)}
                >
                  <span className="truncate">{tab.name}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="h-px bg-white/[0.06] my-[6px] -mx-[6px]" />

      {!maxReached && (
        <button
          className="w-full h-[26px] px-[8px] rounded-[6px] flex items-center gap-[6px] text-fg-muted hover:text-fg hover:bg-surface-hover active:bg-surface-active transition-colors duration-fast"
          onClick={() => setShowNameModal(true)}
        >
          <PlusIcon className="w-[10px] h-[10px] shrink-0" />
          <span className="text-body">{t('tabs.createTitle')}</span>
        </button>
      )}
      {customTabs.length > 0 && (
        <button
          className={`w-full h-[26px] px-[8px] rounded-[6px] flex items-center gap-[6px] transition-colors duration-fast ${
            isCustomSelected
              ? 'text-danger hover:bg-danger-muted active:bg-[rgba(229,72,77,0.2)]'
              : 'text-fg-disabled cursor-not-allowed'
          }`}
          disabled={!isCustomSelected}
          onClick={() => setAskDelete(true)}
        >
          <MinusIcon className="w-[10px] shrink-0" />
          <span className="text-body">{t('tabs.delete')}</span>
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
