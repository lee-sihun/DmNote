/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { useTranslation } from '@contexts/I18nContext';
import PlusIcon from '@assets/svgs/plus2.svg';
import MinusIcon from '@assets/svgs/minus.svg';
import { useKeyStore } from '@stores/useKeyStore';
import { useLenis } from '@hooks/useLenis';
import Alert from '../dialogs/Alert.jsx';
import TabNameModal from '../editors/TabNameModal';

type TabListProps = {
  onClose?: () => void;
};

const MAX_CUSTOM_TABS = 30;
const VISIBLE_TAB_COUNT = 5;
const TAB_ITEM_HEIGHT = 24;
const TAB_ITEM_GAP = 6;
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

  const isCustomSelected = !['4key', '5key', '6key', '8key'].includes(selectedKeyType);

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
    <div className="flex flex-col items-center justify-center max-w-[154px] bg-button-primary rounded-[7px] border border-button-hover">
      <div className="min-h-[39px] w-full border-b-[1px] border-button-hover flex flex-col items-center justify-center p-[8px] gap-[8px]">
        {customTabs.length === 0 ? (
          <span className="text-style-2 text-[#DBDEE8]">{t('tabs.empty')}</span>
        ) : (
          <div
            ref={scrollRef}
            className="flex flex-col w-full gap-[6px] overflow-y-auto modal-content-scroll"
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
              className="flex flex-col gap-[6px]"
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
                    className={`w-full min-h-[24px] h-[24px] flex-shrink-0 flex items-center justify-center rounded-[7px] text-style-2 text-[#DBDEE8] hover:bg-button-hover active:bg-button-active ${
                      selectedKeyType === tab.id ? 'bg-button-hover' : ''
                    }`}
                    onClick={() => handleSelect(tab.id)}
                  >
                    {tab.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-row p-[8px] w-[154px] gap-[8px]">
        {!maxReached && (
          <button
            className="flex flex-1 items-center justify-center max-w-[138px] h-[22px] rounded-[7px] bg-button-hover hover:bg-button-active active:bg-[#333333]"
            onClick={() => setShowNameModal(true)}
          >
            <PlusIcon />
          </button>
        )}
        {customTabs.length > 0 && (
          <button
            className={`flex flex-1 items-center justify-center max-w-[138px] h-[22px] rounded-[7px] ${
              isCustomSelected
                ? 'bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929]'
                : 'bg-button-hover opacity-50 cursor-not-allowed'
            }`}
            disabled={!isCustomSelected}
            onClick={() => setAskDelete(true)}
          >
            <MinusIcon />
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
