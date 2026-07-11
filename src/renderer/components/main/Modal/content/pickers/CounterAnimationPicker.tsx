import React, { useEffect, useState } from 'react';
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
import CommonListPickerPopup from './CommonListPickerPopup';
import { pickerRowClass, pickerMoreButtonClass } from './pickerRowClass';
import CounterAnimationEditorModal from '../editors/CounterAnimationEditorModal';

interface CounterAnimationPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  animation: KeyCounterAnimationSettings;
  counterSettings?: KeyCounterSettings;
  keyVisual?: {
    width?: number;
    height?: number;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    fontColor?: string;
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    fontItalic?: boolean;
    fontUnderline?: boolean;
    fontStrikethrough?: boolean;
    displayText?: string;
    displayName?: string;
    className?: string;
    activeBackgroundColor?: string;
    activeBorderColor?: string;
    activeFontColor?: string;
    useInlineStyles?: boolean;
    isStat?: boolean;
  };
  onAnimationChange: (next: KeyCounterAnimationSettings) => void;
  onClose: () => void;
  t: (key: string) => string;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  // 페이지 모드 패스스루 — 패널 서브 페이지로 렌더할 때 사용
  renderMode?: 'popup' | 'page';
  pageTitle?: string;
  onBack?: () => void;
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

const CounterAnimationPicker = ({
  open,
  referenceRef,
  panelElement = null,
  animation,
  counterSettings,
  keyVisual,
  onAnimationChange,
  onClose,
  t,
  interactiveRefs = [],
  renderMode = 'popup',
  pageTitle,
  onBack,
}: CounterAnimationPickerProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [library, setLibrary] =
    useState<CounterAnimationListResponse>(EMPTY_LIBRARY);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const menu = usePickerItemMenu<string>();

  const loadLibrary = async () => {
    setIsLoading(true);
    setErrorText('');
    try {
      const response = await window.api.counterAnimation.list();
      setLibrary(normalizeCounterAnimationLibrary(response));
    } catch (error) {
      console.error('Failed to load counter animation presets', error);
      setErrorText(
        t('counterSetting.loadAnimationFailed') ||
          '애니메이션 목록을 불러오지 못했습니다.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadLibrary();
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

    try {
      await window.api.counterAnimation.remove(preset.id);
      await loadLibrary();
    } catch (error) {
      console.error('Failed to delete counter animation preset', error);
      setErrorText(
        t('counterSetting.deleteAnimationFailed') ||
          '애니메이션 삭제에 실패했습니다.',
      );
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
    if (mode === 'create' || selectedPresetId === preset.id) {
      onAnimationChange(applyPresetToAnimation(animation, preset));
    }
  };

  const handlePickerClose = () => {
    if (menu.menuKey !== null) return;
    onClose();
  };

  return (
    <>
      <CommonListPickerPopup<CounterAnimationPreset>
        open={open}
        referenceRef={referenceRef}
        panelElement={panelElement}
        interactiveRefs={interactiveRefs}
        renderMode={renderMode}
        pageTitle={pageTitle}
        onBack={onBack}
        onClose={handlePickerClose}
        estimatedHeight={276}
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
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handlePresetSelect(preset);
                }
              }}
              className={`${pickerRowClass(renderMode)} cursor-pointer ${
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
                  className={`${pickerMoreButtonClass(renderMode)} ${
                    isSelected || menu.menuKey === preset.id
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  } ${
                    isSelected
                      ? 'text-fg hover:text-fg hover:bg-surface-active'
                      : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
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

      {menu.menuKey !== null && (
        <ListPopup
          open
          position={menu.menuPosition ?? undefined}
          onClose={menu.close}
          textAlign="center"
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
          className="z-[60]"
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
