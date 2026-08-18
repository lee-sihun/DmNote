import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import type { SoundListItem } from '@src/types/plugin/api';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import CommonListPickerPage from './CommonListPickerPage';
import {
  pickerRowClass,
  pickerMoreButtonClass,
  pickerMoreButtonVisibleClass,
  pickerMoreButtonHiddenClass,
} from './pickerRowClass';
import MoreVerticalIcon from './MoreVerticalIcon';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import SoundTrimModal from '../managers/SoundTrimModal';
import { useEditSessionCompletionGuard } from '@src/renderer/contexts/EditSessionScope';

import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';
import { soundApi } from '@api/modules/resourceApi';
import { openRemoteSheet } from '@stores/grid/useRemoteSheetStore';

interface SoundPickerProps {
  open: boolean;
  selectedSound: string | null;
  onSoundSelect: (soundPath: string | null) => void;
  pageTitle: string;
  onBack: () => void;
  previewVolume?: number;
  /** 비동기 완료 콜백이 안정 ID applier로 라우팅되면 element-id */
  completionBinding?: CompletionBinding;
}

type TrimState =
  | { mode: 'create'; file: File | null }
  | { mode: 'edit'; item: SoundListItem };

let soundListCache: SoundListItem[] | null = null;

const SoundPicker = ({
  open,
  selectedSound,
  onSoundSelect,
  pageTitle,
  onBack,
  previewVolume,
  completionBinding = 'session-mode',
}: SoundPickerProps) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'local' | 'hidden'>(
    'all',
  );
  const [sounds, setSounds] = useState<SoundListItem[]>(
    () => soundListCache ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [trimState, setTrimState] = useState<TrimState | null>(null);
  const canBindCompletion = useEditSessionCompletionGuard(completionBinding);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const loadRequestRef = useRef(0);
  const isOpenRef = useRef(open);
  const pendingSoundActionsRef = useRef(new Set<string>());
  const menu = usePickerItemMenu<string>();

  const normalizedSelectedSound = (selectedSound || '').trim();

  const loadSounds = async () => {
    const requestId = ++loadRequestRef.current;
    const cachedSounds = soundListCache;
    if (cachedSounds) {
      setSounds(cachedSounds);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setLoadError('');
    try {
      const nextSounds = await window.api.sound.list();
      if (requestId !== loadRequestRef.current) return;
      soundListCache = nextSounds;
      if (!isOpenRef.current) return;
      setSounds(nextSounds);
    } catch (error) {
      if (requestId !== loadRequestRef.current || !isOpenRef.current) return;
      console.error('Failed to load sound list', error);
      setLoadError(t('soundPicker.loadFailed') || '사운드 목록 로드 실패');
    } finally {
      if (requestId === loadRequestRef.current && isOpenRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    isOpenRef.current = open;
    if (!open) return;
    void loadSounds();

    return () => {
      isOpenRef.current = false;
      loadRequestRef.current += 1;
    };
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
    { value: 'hidden', label: t('soundPicker.filterHidden') || '숨긴 사운드' },
  ];

  const filteredSounds = (() => {
    const query = searchQuery.trim().toLowerCase();

    return sounds.filter((item) => {
      if (filterType === 'hidden') {
        if (!item.hidden) return false;
      } else {
        if (item.hidden) return false;
        if (filterType === 'local' && item.source !== 'local') return false;
      }
      if (!query) return true;
      return (
        item.fileName.toLowerCase().includes(query) ||
        (item.displayName?.toLowerCase().includes(query) ?? false)
      );
    });
  })();

  const menuTargetItem =
    menu.renderKey !== null
      ? sounds.find((item) => item.soundPath === menu.renderKey) ?? null
      : null;

  const menuItems: ListItem[] = menuTargetItem
    ? [
        ...(menuTargetItem.source === 'local'
          ? [
              {
                id: 'edit',
                label: t('soundPicker.edit') || '편집',
                disabled: !menuTargetItem.originalPath,
              },
              {
                id: 'rename',
                label: t('soundPicker.rename') || '이름 변경',
              },
            ]
          : []),
        {
          id: 'toggle-hidden',
          label: menuTargetItem.hidden
            ? t('soundPicker.unhide') || '숨김 해제'
            : t('soundPicker.hide') || '숨기기',
        },
        ...(menuTargetItem.source === 'local'
          ? [
              {
                id: 'delete',
                label: t('soundPicker.delete') || '삭제',
              },
            ]
          : []),
      ]
    : [];

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
    if (pendingSoundActionsRef.current.has(item.soundPath)) return;
    pendingSoundActionsRef.current.add(item.soundPath);

    try {
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

      loadRequestRef.current += 1;
      setSounds((current) => {
        const next = current.filter(
          (candidate) => candidate.soundPath !== item.soundPath,
        );
        soundListCache = next;
        return next;
      });
      await soundApi.remove(item.soundPath);
      // 백엔드가 참조 해제와 canonical 동기화를 소유
      // 응답 대기 중 새로 선택한 사운드를 예전 선택으로 재판단해 지우지 않는다
      await loadSounds();
    } catch (error) {
      console.error('Failed to delete sound', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.deleteFailed') || '사운드 삭제 실패');
    } finally {
      pendingSoundActionsRef.current.delete(item.soundPath);
    }
  };

  const commitRename = async (item: SoundListItem) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === (item.displayName || item.fileName)) return;
    if (pendingSoundActionsRef.current.has(item.soundPath)) return;
    pendingSoundActionsRef.current.add(item.soundPath);
    try {
      loadRequestRef.current += 1;
      setSounds((current) => {
        const next = current.map((candidate) =>
          candidate.soundPath === item.soundPath
            ? { ...candidate, displayName: trimmed }
            : candidate,
        );
        soundListCache = next;
        return next;
      });
      await soundApi.rename(item.soundPath, trimmed);
      await loadSounds();
    } catch (error) {
      console.error('Failed to rename sound', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.renameFailed') || '사운드 이름 변경 실패');
    } finally {
      pendingSoundActionsRef.current.delete(item.soundPath);
    }
  };

  const handleToggleHidden = async (item: SoundListItem) => {
    if (pendingSoundActionsRef.current.has(item.soundPath)) return;
    pendingSoundActionsRef.current.add(item.soundPath);
    try {
      const nextHidden = !item.hidden;
      loadRequestRef.current += 1;
      setSounds((current) => {
        const next = current.map((candidate) =>
          candidate.soundPath === item.soundPath
            ? { ...candidate, hidden: nextHidden }
            : candidate,
        );
        soundListCache = next;
        return next;
      });
      await soundApi.setHidden(item.soundPath, nextHidden);
      await loadSounds();
    } catch (error) {
      console.error('Failed to toggle sound hidden', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.hideFailed') || '사운드 숨김 변경 실패');
    } finally {
      pendingSoundActionsRef.current.delete(item.soundPath);
    }
  };

  const handleTrimSaved = (soundPath: string) => {
    // 사운드 파일은 이미 저장됐다. 대상이 갈렸으면 연결만 하지 않는다
    // (element-id 결합이면 ID applier가 유효성을 판정하므로 통과)
    if (canBindCompletion()) onSoundSelect(soundPath);
    setTrimState(null);
    void loadSounds();
  };

  // 분리 패널 창은 시트가 들어갈 폭이 없어 메인 창에 대신 띄운다. 파일은 창을 넘지 못하므로
  // 추가는 시트 안의 불러오기 버튼으로 고른다. 결과는 돌아온 시점의 최신 핸들러로 적용한다
  const handleTrimSavedRef = useRef(handleTrimSaved);
  useEffect(() => {
    handleTrimSavedRef.current = handleTrimSaved;
  });
  const openTrimSheet = (
    request: { mode: 'create' } | { mode: 'edit'; item: SoundListItem },
  ) => {
    if (window.__dmn_window_type !== 'panel') {
      if (request.mode === 'create') {
        // 시트를 먼저 띄우고 대화상자를 열어 닫힘 순간 캔버스 노출 방지
        setTrimState({ mode: 'create', file: null });
        addFileInputRef.current?.click();
      } else {
        setTrimState({ mode: 'edit', item: request.item });
      }
      return;
    }
    void openRemoteSheet(
      request.mode === 'create'
        ? { kind: 'soundTrim', mode: 'create', previewVolume }
        : {
            kind: 'soundTrim',
            mode: 'edit',
            previewVolume,
            item: {
              soundPath: request.item.soundPath,
              trimStartRatio: request.item.trimStartRatio,
              trimEndRatio: request.item.trimEndRatio,
              displayName: request.item.displayName,
            },
          },
    ).then((result) => {
      if (result.status !== 'saved' || result.kind !== 'soundTrim') return;
      handleTrimSavedRef.current(result.soundPath);
    });
  };

  return (
    <>
      <CommonListPickerPage<SoundListItem>
        open={open}
        pageTitle={pageTitle}
        onBack={onBack}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={t('soundPicker.searchPlaceholder') || '검색'}
        filterOptions={filterOptions}
        filterValue={filterType}
        onFilterChange={(value) =>
          setFilterType(value as 'all' | 'local' | 'hidden')
        }
        items={filteredSounds}
        renderItem={(item) => {
          const isSelected = item.soundPath === normalizedSelectedSound;
          const displayName = item.displayName || item.fileName;

          return (
            <div
              key={item.soundPath}
              role="button"
              tabIndex={0}
              onClick={() => onSoundSelect(isSelected ? '' : item.soundPath)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSoundSelect(isSelected ? '' : item.soundPath);
                }
              }}
              onContextMenu={(event) =>
                menu.openFromContextMenu(event, item.soundPath)
              }
              className={`${pickerRowClass} cursor-pointer ${
                isSelected ? 'bg-fill-hover text-fg' : 'text-fg hover:bg-fill'
              }`}
              title={displayName}
            >
              {renamingPath === item.soundPath ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="min-w-0 flex-1 bg-transparent border-none p-0 outline-none text-label text-fg caret-accent"
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

              <button
                type="button"
                className={`${pickerMoreButtonClass} ${
                  isSelected || menu.menuKey === item.soundPath
                    ? pickerMoreButtonVisibleClass
                    : pickerMoreButtonHiddenClass
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
                onClick={(event) => menu.openFromButton(event, item.soundPath)}
              >
                <MoreVerticalIcon />
              </button>
            </div>
          );
        }}
        emptyText={t('soundPicker.noSounds') || '사운드 없음'}
        isLoading={isLoading}
        loadingText={t('propertiesPanel.loading') || '로딩...'}
        errorText={loadError}
        onAdd={() => openTrimSheet({ mode: 'create' })}
        addLabel={t('soundPicker.add') || '사운드 추가'}
      />

      <input
        ref={addFileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleAddFileChange}
      />

      {menu.renderKey !== null && (
        <ListPopup
          open={menu.menuKey !== null}
          ariaLabel={t('common.more')}
          position={menu.renderPosition ?? undefined}
          onClose={menu.close}
          items={menuItems}
          onSelect={(id) => {
            const item = menuTargetItem;
            menu.close();
            if (!item) return;
            if (id === 'edit') {
              openTrimSheet({ mode: 'edit', item });
            } else if (id === 'toggle-hidden') {
              void handleToggleHidden(item);
            } else if (id === 'rename') {
              renameCancelledRef.current = false;
              setRenameValue(item.displayName || item.fileName);
              setRenamingPath(item.soundPath);
            } else if (id === 'delete') {
              void handleDelete(item);
            }
          }}
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
