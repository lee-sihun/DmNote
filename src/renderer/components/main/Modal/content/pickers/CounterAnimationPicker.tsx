import React, { useEffect, useRef, useState } from 'react';
import type {
  KeyCounterAnimationSettings,
  KeyCounterSettings,
} from '@src/types/key/keys';
import type {
  CounterAnimationListResponse,
  CounterAnimationPreset,
} from '@src/types/key/counterAnimation';
import {
  applyPresetToAnimation,
  findMatchingPresetId,
  normalizeCounterAnimationLibrary,
} from '@src/types/key/counterAnimation';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import CommonListPickerPage from './CommonListPickerPage';
import {
  pickerRowClass,
  pickerMoreButtonClass,
  pickerMoreButtonVisibleClass,
  pickerMoreButtonHiddenClass,
} from './pickerRowClass';
import CounterAnimationEditorModal from '../editors/CounterAnimationEditorModal';
import type { CounterAnimationKeyVisual } from '@utils/core/counterAnimationPreview';
import { useEditSessionCompletionGuard } from '@src/renderer/contexts/EditSessionScope';

import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';
import { counterAnimationApi } from '@api/modules/resourceApi';
import { deleteCounterAnimationPresetViaAuthority } from '@plugins/rpc/pluginElementActions';

interface CounterAnimationPickerProps {
  open: boolean;
  animation: KeyCounterAnimationSettings;
  counterSettings?: KeyCounterSettings;
  keyVisual?: CounterAnimationKeyVisual;
  onAnimationChange: (next: KeyCounterAnimationSettings) => void;
  t: (key: string) => string;
  pageTitle: string;
  onBack: () => void;
  /** 비동기 완료 콜백이 안정 ID applier로 라우팅되면 element-id */
  completionBinding?: CompletionBinding;
}

type FilterType = 'all' | 'builtin' | 'user';
type EditorState =
  | { mode: 'create'; preset: null }
  | { mode: 'edit'; preset: CounterAnimationPreset };

const MoreVerticalIcon: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="6" cy="2.5" r="1" fill="currentColor" />
    <circle cx="6" cy="6" r="1" fill="currentColor" />
    <circle cx="6" cy="9.5" r="1" fill="currentColor" />
  </svg>
);

const EMPTY_LIBRARY: CounterAnimationListResponse = {
  builtinPresets: [],
  userPresets: [],
};

let counterAnimationLibraryCache: CounterAnimationListResponse | null = null;

const CounterAnimationPicker = ({
  open,
  animation,
  counterSettings,
  keyVisual,
  onAnimationChange,
  t,
  pageTitle,
  onBack,
  completionBinding = 'session-mode',
}: CounterAnimationPickerProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [library, setLibrary] = useState<CounterAnimationListResponse>(
    () => counterAnimationLibraryCache ?? EMPTY_LIBRARY,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const canBindCompletion = useEditSessionCompletionGuard(completionBinding);
  const loadRequestRef = useRef(0);
  const isOpenRef = useRef(open);
  const pendingPresetActionsRef = useRef(new Set<string>());
  const menu = usePickerItemMenu<string>();

  const loadLibrary = async () => {
    const requestId = ++loadRequestRef.current;
    const cachedLibrary = counterAnimationLibraryCache;
    if (cachedLibrary) {
      setLibrary(cachedLibrary);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setErrorText('');
    try {
      const response = await window.api.counterAnimation.list();
      const nextLibrary = normalizeCounterAnimationLibrary(response);
      if (requestId !== loadRequestRef.current) return;
      counterAnimationLibraryCache = nextLibrary;
      if (!isOpenRef.current) return;
      setLibrary(nextLibrary);
    } catch (error) {
      if (requestId !== loadRequestRef.current || !isOpenRef.current) return;
      console.error('Failed to load counter animation presets', error);
      setErrorText(
        t('counterSetting.loadAnimationFailed') ||
          '애니메이션 목록을 불러오지 못했습니다.',
      );
    } finally {
      if (requestId === loadRequestRef.current && isOpenRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    isOpenRef.current = open;
    if (!open) return;
    void loadLibrary();

    return () => {
      isOpenRef.current = false;
      loadRequestRef.current += 1;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) return;
    menu.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allPresets = [...library.builtinPresets, ...library.userPresets];

  const selectedPresetId = findMatchingPresetId(animation, library);

  const filterOptions = [
    {
      value: 'all',
      label: t('counterSetting.filterAll') || '전체',
    },
    {
      value: 'builtin',
      label: t('counterSetting.filterBuiltin') || '내장',
    },
    {
      value: 'user',
      label: t('counterSetting.filterUser') || '사용자정의',
    },
  ];

  const filteredItems = (() => {
    const query = searchQuery.trim().toLowerCase();

    return allPresets.filter((preset) => {
      if (filterType !== 'all' && preset.source !== filterType) {
        return false;
      }

      if (!query) return true;

      const fallbackName =
        preset.labelKey && t(preset.labelKey) !== preset.labelKey
          ? t(preset.labelKey)
          : preset.name;
      return (
        preset.name.toLowerCase().includes(query) ||
        fallbackName.toLowerCase().includes(query)
      );
    });
  })();

  const handlePresetSelect = (preset: CounterAnimationPreset) => {
    menu.close();
    onAnimationChange(applyPresetToAnimation(animation, preset));
  };

  const handleDeletePreset = async (preset: CounterAnimationPreset) => {
    if (pendingPresetActionsRef.current.has(preset.id)) return;
    pendingPresetActionsRef.current.add(preset.id);

    try {
      const confirmed = await window.api.ui.dialog.confirm(
        t('counterSetting.deleteAnimationConfirm') ||
          '애니메이션을 삭제하시겠습니까?',
        {
          confirmText: t('contextMenu.delete') || '삭제',
          cancelText: t('common.cancel') || '취소',
          danger: true,
        },
      );
      if (!confirmed) return;

      loadRequestRef.current += 1;
      setLibrary((current) => {
        const next = {
          ...current,
          userPresets: current.userPresets.filter(
            (candidate) => candidate.id !== preset.id,
          ),
        };
        counterAnimationLibraryCache = next;
        return next;
      });
      const removed =
        window.__dmn_window_type === 'panel'
          ? await deleteCounterAnimationPresetViaAuthority(preset.id)
          : await counterAnimationApi.remove(preset.id);
      if (!removed) throw new Error('counter animation delete failed');
      await loadLibrary();
    } catch (error) {
      console.error('Failed to delete counter animation preset', error);
      await loadLibrary();
      setErrorText(
        t('counterSetting.deleteAnimationFailed') ||
          '애니메이션 삭제에 실패했습니다.',
      );
    } finally {
      pendingPresetActionsRef.current.delete(preset.id);
    }
  };

  const openCreateModal = () => {
    setEditorState({ mode: 'create', preset: null });
  };

  const openEditModal = (preset: CounterAnimationPreset) => {
    menu.close();
    setEditorState({ mode: 'edit', preset });
  };

  const menuItems: ListItem[] = [
    {
      id: 'edit',
      label: t('counterSetting.editAnimation') || '편집',
    },
    {
      id: 'delete',
      label: t('counterSetting.deleteAnimation') || '삭제',
    },
  ];
  const moreMenuLabel = (() => {
    const translated = t('common.more');
    return translated && translated !== 'common.more' ? translated : '더보기';
  })();

  const handleEditorSaved = async ({
    preset,
    mode,
  }: {
    preset: CounterAnimationPreset;
    mode: 'create' | 'edit';
    affectedUsageCount: number;
  }) => {
    await loadLibrary();
    // preset은 라이브러리에 이미 저장됐다. 대상이 갈렸으면 적용만 하지 않는다
    // (element-id 결합이면 ID applier가 유효성을 판정하므로 통과)
    if (!canBindCompletion()) return;
    if (mode === 'create' || selectedPresetId === preset.id) {
      onAnimationChange(applyPresetToAnimation(animation, preset));
    }
  };

  return (
    <>
      <CommonListPickerPage<CounterAnimationPreset>
        open={open}
        pageTitle={pageTitle}
        onBack={onBack}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={
          t('counterSetting.searchAnimationPlaceholder') || '검색'
        }
        filterOptions={filterOptions}
        filterValue={filterType}
        onFilterChange={(value) => setFilterType(value as FilterType)}
        items={filteredItems}
        renderItem={(preset) => {
          const isSelected = selectedPresetId === preset.id;
          const isUserPreset = preset.source === 'user';
          const displayName =
            preset.labelKey && t(preset.labelKey) !== preset.labelKey
              ? t(preset.labelKey)
              : preset.name;

          return (
            <div
              key={preset.id}
              role="button"
              tabIndex={0}
              onClick={() => handlePresetSelect(preset)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handlePresetSelect(preset);
                }
              }}
              className={`${pickerRowClass} cursor-pointer ${
                isSelected
                  ? 'bg-surface-active text-fg'
                  : 'text-fg hover:bg-surface-hover'
              }`}
              title={displayName}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {displayName}
              </span>

              {isUserPreset ? (
                <button
                  type="button"
                  className={`${pickerMoreButtonClass} ${
                    isSelected || menu.menuKey === preset.id
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
                    menu.capturePressState(preset.id);
                  }}
                  onClick={(event) => menu.openFromButton(event, preset.id)}
                >
                  <MoreVerticalIcon />
                </button>
              ) : null}
            </div>
          );
        }}
        emptyText={
          t('counterSetting.noAnimations') || '등록된 애니메이션이 없습니다'
        }
        isLoading={isLoading}
        loadingText={t('propertiesPanel.loading') || '로딩...'}
        errorText={errorText}
        onAdd={openCreateModal}
        addLabel={t('counterSetting.addAnimation') || '애니메이션 추가'}
      />

      {menu.renderKey !== null && (
        <ListPopup
          open={menu.menuKey !== null}
          ariaLabel={t('common.more')}
          position={menu.renderPosition ?? undefined}
          onClose={menu.close}
          items={menuItems}
          onSelect={(id) => {
            const preset = allPresets.find((p) => p.id === menu.menuKey);
            if (!preset) return;
            if (id === 'edit') {
              openEditModal(preset);
            } else if (id === 'delete') {
              void handleDeletePreset(preset);
            }
            menu.close();
          }}
          offsetX={0}
          offsetY={0}
        />
      )}

      <CounterAnimationEditorModal
        isOpen={!!editorState}
        mode={editorState?.mode || 'create'}
        initialPreset={editorState?.preset || null}
        counterSettings={counterSettings}
        keyVisual={keyVisual}
        onClose={() => setEditorState(null)}
        onSaved={handleEditorSaved}
        t={t}
      />
    </>
  );
};

export default CounterAnimationPicker;
