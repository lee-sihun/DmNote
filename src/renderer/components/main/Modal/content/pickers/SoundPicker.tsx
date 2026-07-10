import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import type { SoundListItem } from '@src/types/plugin/api';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import CommonListPickerPopup from './CommonListPickerPopup';
import MoreVerticalIcon from './MoreVerticalIcon';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import SoundTrimModal from '../managers/SoundTrimModal';

interface SoundPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  selectedSound: string | null;
  onSoundSelect: (soundPath: string | null) => void;
  onClose: () => void;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  // 페이지 모드 패스스루 — 패널 서브 페이지로 렌더할 때 사용
  renderMode?: 'popup' | 'page';
  pageTitle?: string;
  onBack?: () => void;
  previewVolume?: number;
}

type TrimState =
  | { mode: 'create'; file: File }
  | { mode: 'edit'; item: SoundListItem };

const SoundPicker = ({
  open,
  referenceRef,
  panelElement = null,
  selectedSound,
  onSoundSelect,
  onClose,
  interactiveRefs = [],
  renderMode = 'popup',
  pageTitle,
  onBack,
  previewVolume,
}: SoundPickerProps) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'local'>('all');
  const [sounds, setSounds] = useState<SoundListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [trimState, setTrimState] = useState<TrimState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const menu = usePickerItemMenu<string>();

  const normalizedSelectedSound = (selectedSound || '').trim();

  const loadSounds = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const nextSounds = await window.api.sound.list();
      setSounds(nextSounds);
    } catch (error) {
      console.error('Failed to load sound list', error);
      setLoadError(t('soundPicker.loadFailed') || '사운드 목록 로드 실패');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadSounds();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) return;
    menu.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 이름 변경 시작 시 입력에 포커스
  useEffect(() => {
    if (renamingPath === null) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingPath]);

  const filterOptions = [
    { value: 'all', label: t('soundPicker.filterAll') || '전체' },
    { value: 'local', label: t('soundPicker.filterLocal') || '로컬 사운드' },
  ];

  const filteredSounds = (() => {
    const query = searchQuery.trim().toLowerCase();

    return sounds.filter((item) => {
      if (filterType === 'local' && item.source !== 'local') {
        return false;
      }
      if (!query) return true;
      return (
        item.fileName.toLowerCase().includes(query) ||
        (item.displayName?.toLowerCase().includes(query) ?? false)
      );
    });
  })();

  const menuTargetItem =
    menu.menuKey !== null
      ? sounds.find((item) => item.soundPath === menu.menuKey) ?? null
      : null;

  const menuItems: ListItem[] = [
    {
      id: 'edit',
      label: t('soundPicker.edit') || '편집',
      disabled: !menuTargetItem?.originalPath,
    },
    {
      id: 'rename',
      label: t('soundPicker.rename') || '이름 변경',
    },
    {
      id: 'delete',
      label: t('soundPicker.delete') || '삭제',
    },
  ];

  const moreMenuLabel = (() => {
    const translated = t('common.more');
    return translated && translated !== 'common.more' ? translated : '더보기';
  })();

  const handleAddFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (addFileInputRef.current) {
      addFileInputRef.current.value = '';
    }
    if (!file) return;
    setTrimState({ mode: 'create', file });
  };

  const handleDelete = async (item: SoundListItem) => {
    const confirmed = await window.api.ui.dialog.confirm(
      t('soundPicker.deleteConfirm') ||
        '사운드를 삭제하시겠습니까? 파일이 삭제되고 이 사운드를 사용하는 모든 요소에서 해제됩니다.',
      {
        confirmText: t('contextMenu.delete') || '삭제',
        cancelText: t('common.cancel') || '취소',
        danger: true,
      },
    );

    if (!confirmed) return;

    try {
      await window.api.sound.remove(item.soundPath);
      if (normalizedSelectedSound === item.soundPath) {
        onSoundSelect(null);
      }
      await loadSounds();
    } catch (error) {
      console.error('Failed to delete sound', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.deleteFailed') || '사운드 삭제 실패');
    }
  };

  const commitRename = async (item: SoundListItem) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === (item.displayName || item.fileName)) return;
    try {
      await window.api.sound.rename(item.soundPath, trimmed);
      await loadSounds();
    } catch (error) {
      console.error('Failed to rename sound', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.renameFailed') || '사운드 이름 변경 실패');
    }
  };

  const handleTrimSaved = (soundPath: string) => {
    onSoundSelect(soundPath);
    setTrimState(null);
    void loadSounds();
  };

  const handlePickerClose = () => {
    if (menu.menuKey !== null) return;
    onClose();
  };

  return (
    <>
      <CommonListPickerPopup<SoundListItem>
        open={open}
        referenceRef={referenceRef}
        panelElement={panelElement}
        interactiveRefs={interactiveRefs}
        renderMode={renderMode}
        pageTitle={pageTitle}
        onBack={onBack}
        onClose={handlePickerClose}
        widthClass="w-[156px]"
        estimatedWidth={164}
        estimatedHeight={276}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={t('soundPicker.searchPlaceholder') || '검색'}
        filterOptions={filterOptions}
        filterValue={filterType}
        onFilterChange={(value) => setFilterType(value as 'all' | 'local')}
        items={filteredSounds}
        renderItem={(item) => {
          const isSelected = item.soundPath === normalizedSelectedSound;
          const isLocal = item.source === 'local';
          const displayName = item.displayName || item.fileName;

          return (
            <div
              key={item.soundPath}
              role="button"
              tabIndex={0}
              onClick={() => onSoundSelect(item.soundPath)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSoundSelect(item.soundPath);
                }
              }}
              onContextMenu={
                isLocal
                  ? (event) => menu.openFromContextMenu(event, item.soundPath)
                  : undefined
              }
              className={`w-full h-[24px] px-[8px] rounded-md text-style-4 transition-colors flex items-center gap-[4px] cursor-pointer group ${
                isSelected
                  ? 'bg-surface-active text-fg'
                  : 'text-fg hover:bg-surface-hover'
              }`}
              title={displayName}
            >
              {renamingPath === item.soundPath ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="min-w-0 flex-1 bg-transparent border-none p-0 outline-none text-style-4 text-fg caret-accent"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => {
                    if (!renameCancelledRef.current) void commitRename(item);
                    renameCancelledRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      renameCancelledRef.current = true;
                      setRenamingPath(null);
                    }
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-left">
                  {displayName}
                </span>
              )}

              {isLocal ? (
                <button
                  type="button"
                  className={`w-[18px] h-[18px] -mr-[8px] rounded-md transition-all flex items-center justify-center shrink-0 ${
                    isSelected || menu.menuKey === item.soundPath
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  } ${
                    isSelected
                      ? 'text-fg hover:text-fg'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                  title={moreMenuLabel}
                  aria-label={moreMenuLabel}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    menu.capturePressState(item.soundPath);
                  }}
                  onClick={(event) =>
                    menu.openFromButton(event, item.soundPath)
                  }
                >
                  <MoreVerticalIcon />
                </button>
              ) : null}
            </div>
          );
        }}
        emptyText={t('soundPicker.noSounds') || '사운드 없음'}
        isLoading={isLoading}
        loadingText={t('propertiesPanel.loading') || '로딩...'}
        errorText={loadError}
        onAdd={() => addFileInputRef.current?.click()}
        addLabel={t('soundPicker.add') || '사운드 추가'}
      />

      <input
        ref={addFileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleAddFileChange}
      />

      {menu.menuKey !== null && (
        <ListPopup
          open
          position={menu.menuPosition ?? undefined}
          onClose={menu.close}
          textAlign="center"
          items={menuItems}
          onSelect={(id) => {
            const item = menuTargetItem;
            menu.close();
            if (!item) return;
            if (id === 'edit') {
              setTrimState({ mode: 'edit', item });
            } else if (id === 'rename') {
              renameCancelledRef.current = false;
              setRenameValue(item.displayName || item.fileName);
              setRenamingPath(item.soundPath);
            } else if (id === 'delete') {
              void handleDelete(item);
            }
          }}
          className="z-[60]"
          offsetX={0}
          offsetY={0}
        />
      )}

      <SoundTrimModal
        isOpen={trimState !== null}
        onClose={() => setTrimState(null)}
        onSaved={handleTrimSaved}
        previewVolume={previewVolume}
        editingSoundPath={
          trimState?.mode === 'edit' ? trimState.item.soundPath : null
        }
        editingTrimStartRatio={
          trimState?.mode === 'edit' ? trimState.item.trimStartRatio : undefined
        }
        editingTrimEndRatio={
          trimState?.mode === 'edit' ? trimState.item.trimEndRatio : undefined
        }
        editingDisplayName={
          trimState?.mode === 'edit' ? trimState.item.displayName : undefined
        }
        initialFile={trimState?.mode === 'create' ? trimState.file : null}
      />
    </>
  );
};

export default SoundPicker;
