import React, {
  type ChangeEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import Modal from '../../Modal';
import { useTranslation } from '@contexts/useTranslation';
import type { SoundListItem } from '@src/types/plugin/api';
import { useLenis } from '@hooks/useLenis';
import { getScrollShadowState } from '@utils/grid/scrollShadow';
import SoundTrimModal from './SoundTrimModal';
import Checkbox from '@components/main/common/Checkbox';
import TrashIcon from '@assets/svgs/trash.svg';

interface SoundManagerModalProps {
  isOpen: boolean;
  selectedSound: string | null;
  onSelectSound: (soundPath: string | null) => void;
  onClose: () => void;
  previewVolume?: number;
}

const MAX_SCROLL_HEIGHT = 195;

export default function SoundManagerModal({
  isOpen,
  selectedSound,
  onSelectSound,
  onClose,
  previewVolume,
}: SoundManagerModalProps) {
  const { t } = useTranslation();
  const [sounds, setSounds] = useState<SoundListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showTrimModal, setShowTrimModal] = useState(false);
  const [editingSoundPath, setEditingSoundPath] = useState<string | null>(null);

  const addFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    hasTopShadow: false,
    hasBottomShadow: false,
  });
  const [skipShadowTransition, setSkipShadowTransition] = useState(true);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const isFirstRender = useRef(true);
  const hasLoadedRef = useRef(false);

  const normalizedSelectedSound = (selectedSound || '').trim();

  const editingSoundItem = editingSoundPath
    ? sounds.find((s) => s.soundPath === editingSoundPath) ?? null
    : null;

  const loadSounds = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const nextSounds = await window.api.sound.list();
      setSounds(nextSounds);
    } catch (error) {
      console.error('Failed to load sound list', error);
      setLoadError(t('soundManager.loadFailed') || '사운드 목록 로드 실패');
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadSounds();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateScrollState = (el: HTMLElement | null) => {
    if (!el) return;
    const nextState = getScrollShadowState(el, contentRef.current);
    setScrollState((prev) =>
      prev.hasTopShadow === nextState.hasTopShadow &&
      prev.hasBottomShadow === nextState.hasBottomShadow
        ? prev
        : nextState,
    );
  };

  const { scrollContainerRef: scrollRef, wrapperElement } = useLenis({
    onScroll: () => updateScrollState(wrapperElement),
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      isFirstRender.current = true;
      hasLoadedRef.current = false;
      return;
    }

    setSkipShadowTransition(true);
    setScrollState({ hasTopShadow: false, hasBottomShadow: false });
    setIsScrollable(false);

    const el = wrapperElement;
    const contentEl = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (contentEl) {
        const contentHeight = contentEl.scrollHeight;
        setContainerHeight(Math.min(contentHeight, MAX_SCROLL_HEIGHT));
        setIsScrollable(contentHeight > MAX_SCROLL_HEIGHT);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState(el);
      updateHeight();
    });

    if (contentEl) {
      resizeObserver.observe(contentEl);
    }
    resizeObserver.observe(el);

    updateScrollState(el);
    updateHeight();

    const rafId = requestAnimationFrame(() => {
      setSkipShadowTransition(false);
      if (hasLoadedRef.current) {
        isFirstRender.current = false;
      }
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [isOpen, sounds, wrapperElement]);

  const handleToggle = async (item: SoundListItem, nextEnabled: boolean) => {
    if (isSaving) return;
    setIsSaving(true);
    setSounds((prev) =>
      prev.map((s) =>
        s.soundPath === item.soundPath ? { ...s, enabled: nextEnabled } : s,
      ),
    );
    try {
      await window.api.sound.setEnabled(item.soundPath, nextEnabled);
    } catch (error) {
      console.error('Failed to toggle sound enabled state', error);
      setSounds((prev) =>
        prev.map((s) =>
          s.soundPath === item.soundPath ? { ...s, enabled: !nextEnabled } : s,
        ),
      );
      setLoadError(
        t('soundManager.stateChangeFailed') || '사운드 상태 변경 실패',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: SoundListItem) => {
    if (isSaving) return;
    setIsSaving(true);
    setSounds((prev) => prev.filter((s) => s.soundPath !== item.soundPath));
    if (normalizedSelectedSound === item.soundPath) {
      onSelectSound(null);
    }
    try {
      await window.api.sound.remove(item.soundPath);
    } catch (error) {
      console.error('Failed to delete sound', error);
      setLoadError(t('soundManager.deleteFailed') || '사운드 삭제 실패');
      await loadSounds();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (addFileInputRef.current) {
      addFileInputRef.current.value = '';
    }
    if (!file) return;
    setPendingFile(file);
    setEditingSoundPath(null);
    setShowTrimModal(true);
  };

  const handleEditSound = (item: SoundListItem) => {
    if (!item.originalPath) return;
    setEditingSoundPath(item.soundPath);
    setShowTrimModal(true);
  };

  const handleCloseTrimModal = () => {
    setShowTrimModal(false);
    setEditingSoundPath(null);
    setPendingFile(null);
  };

  const handleTrimSaved = (soundPath: string) => {
    onSelectSound(soundPath);
    setShowTrimModal(false);
    setEditingSoundPath(null);
    setPendingFile(null);
    void loadSounds();
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal onClick={onClose}>
        <div
          className="flex flex-col bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] pr-[6px]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative" style={{ contain: 'inline-size' }}>
            <div
              className={`absolute top-0 left-0 right-[14px] h-[10px] bg-gradient-to-b from-[#1A191E] to-transparent pointer-events-none z-10 ${
                skipShadowTransition ? '' : 'transition-opacity duration-150'
              } ${scrollState.hasTopShadow ? 'opacity-100' : 'opacity-0'}`}
            />

            <div
              ref={scrollRef}
              className="modal-content-scroll pr-[14px]"
              style={{
                height:
                  containerHeight !== null ? `${containerHeight}px` : 'auto',
                maxHeight: `${MAX_SCROLL_HEIGHT}px`,
                overflowY: isScrollable ? 'auto' : 'hidden',
                transition: isFirstRender.current
                  ? 'none'
                  : 'height 100ms ease-in-out',
                willChange: 'scroll-position',
              }}
            >
              <div
                ref={contentRef}
                className="flex flex-col gap-[19px] py-[5px]"
              >
                {sounds.length === 0 && !isLoading ? (
                  <div className="flex items-center justify-center py-[10px] px-[12px] text-style-2 text-white">
                    {t('soundManager.noSounds') || '사운드 없음'}
                  </div>
                ) : (
                  sounds.map((item) => (
                    <button
                      key={item.soundPath}
                      type="button"
                      onClick={() => onSelectSound(item.soundPath)}
                      className="w-full min-w-0 flex items-center justify-between gap-[8px]"
                      style={{ transform: 'translateZ(0)' }}
                    >
                      <div
                        className="flex items-center gap-[10px] flex-1 min-w-0 overflow-hidden"
                        style={{ height: '20px' }}
                      >
                        <button
                          type="button"
                          className="flex-shrink-0 flex items-center justify-center transition-colors hover:opacity-80"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(item);
                          }}
                          title={t('tabCss.remove') || '삭제'}
                        >
                          <TrashIcon className="w-[14px] h-[15px]" />
                        </button>
                        {item.originalPath ? (
                          <button
                            type="button"
                            className="appearance-none bg-transparent border-0 p-0 m-0 text-white text-style-2 text-left whitespace-nowrap text-ellipsis overflow-hidden block cursor-pointer transition-colors duration-150 hover:text-[#DBDEE8]"
                            style={{ lineHeight: '18px' }}
                            title={t('soundManager.editSound') || '편집'}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleEditSound(item);
                            }}
                          >
                            {item.displayName || item.fileName}
                          </button>
                        ) : (
                          <span
                            className="text-white text-style-2 whitespace-nowrap text-ellipsis overflow-hidden block"
                            style={{ lineHeight: '18px' }}
                            title={item.fileName}
                          >
                            {item.displayName || item.fileName}
                          </span>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex items-center justify-center w-[27px] h-[21px]">
                        <Checkbox
                          checked={item.enabled}
                          onChange={() => {
                            void handleToggle(item, !item.enabled);
                          }}
                        />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div
              className={`absolute bottom-0 left-0 right-[14px] h-[10px] bg-gradient-to-t from-[#1A191E] to-transparent pointer-events-none z-10 ${
                skipShadowTransition ? '' : 'transition-opacity duration-150'
              } ${scrollState.hasBottomShadow ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>

          <div className="h-px bg-[#2A2A30] my-[20px] -ml-[20px] -mr-[6px]" />

          <div className="flex items-center gap-[10.5px] pr-[14px]">
            <button
              type="button"
              className="flex items-center justify-center w-[150px] h-[30px] rounded-[7px] text-style-3 text-[#DCDEE7] transition-colors bg-[#2A2A30] hover:bg-[#34343c]"
              onClick={() => {
                addFileInputRef.current?.click();
              }}
            >
              {`${t('soundManager.addSound') || '추가'} (${sounds.length})`}
            </button>
            <input
              ref={addFileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleAddFileChange}
            />
            <button
              type="button"
              className="flex items-center justify-center w-[75px] h-[30px] bg-[#2A2A30] rounded-[7px] text-style-3 text-[#DCDEE7] hover:bg-[#34343c] transition-colors"
              onClick={onClose}
            >
              {t('common.ok') || '확인'}
            </button>
          </div>

          {isLoading ? (
            <p className="text-[#9FA3B2] text-style-4 mt-[8px]">
              {t('propertiesPanel.loading') || '로딩...'}
            </p>
          ) : null}

          {loadError ? (
            <p className="text-[#E6A7A7] text-style-4 mt-[8px]">{loadError}</p>
          ) : null}
        </div>
      </Modal>

      <SoundTrimModal
        isOpen={showTrimModal}
        onClose={handleCloseTrimModal}
        onSaved={handleTrimSaved}
        previewVolume={previewVolume}
        editingSoundPath={editingSoundPath}
        editingTrimStartRatio={editingSoundItem?.trimStartRatio}
        editingTrimEndRatio={editingSoundItem?.trimEndRatio}
        editingDisplayName={editingSoundItem?.displayName}
        initialFile={pendingFile}
      />
    </>
  );
}
