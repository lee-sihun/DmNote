import {
  startTransition,
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useFontStore } from '@stores/useFontStore';
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamilyName,
  type CustomFont,
} from '@src/types/settings/fonts';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import { useRetainedValue } from '@hooks/ui/useRetainedValue';
import CommonListPickerPage from './CommonListPickerPage';
import {
  pickerRowClass,
  pickerMoreButtonClass,
  pickerMoreButtonVisibleClass,
  pickerMoreButtonHiddenClass,
} from './pickerRowClass';
import MoreVerticalIcon from './MoreVerticalIcon';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import { useFontLibrary } from '@hooks/useFontLibrary';
import WebFontEditorSheet from './WebFontEditorSheet';
import { preloadWebFontEditor } from './webFontEditorLoader';
import {
  getFontPickerPreviewFamily,
  syncFontPickerPreviewCSS,
} from './fontPickerPreload';

interface FontPickerProps {
  open: boolean;
  selectedFont: string | null;
  onFontSelect: (fontName: string | null) => void;
  pageTitle: string;
  onBack: () => void;
}

type FilterType = 'all' | 'builtin' | 'local' | 'web';

const FontPicker = ({
  open,
  selectedFont,
  onFontSelect,
  pageTitle,
  onBack,
}: FontPickerProps) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [addMenuPosition, setAddMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [webFontModal, setWebFontModal] = useState<{
    editingId: string | null;
  } | null>(null);
  const [renamingFontId, setRenamingFontId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const { builtinFonts, customFonts } = useFontStore();
  const fontLibrary = useFontLibrary();
  const menu = usePickerItemMenu<string>();

  // 추가 행이 스크롤 영역 안에 있어 메뉴를 연 채 스크롤하면
  // 고정 좌표 메뉴가 행에서 분리됨 - 스크롤 시작 즉시 닫는다
  useEffect(() => {
    if (addMenuPosition === null) return;
    const closeOnScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-dmn-popup-layer="true"]')) return;
      setAddMenuPosition(null);
    };
    document.addEventListener('scroll', closeOnScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener('scroll', closeOnScroll, { capture: true });
  }, [addMenuPosition]);

  // 첫 페인트 전에 비활성 폰트의 목록 미리보기 face 동기화
  useInsertionEffect(() => {
    if (!open) return;
    syncFontPickerPreviewCSS(customFonts);
  }, [open, customFonts]);

  // 이름 변경 시작 시 입력에 포커스
  useEffect(() => {
    if (renamingFontId === null) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingFontId]);

  // 피커가 열려 있는 동안 웹폰트 편집기 코드를 미리 로드
  useEffect(() => {
    if (!open) return;
    preloadWebFontEditor();
  }, [open]);

  // 필터링된 폰트 목록 (비활성 폰트도 노출 — 행에서 흐리게 표시)
  const filteredFonts = (() => {
    const familyNames = new Set<string>();
    let fonts: CustomFont[] = [...builtinFonts, ...customFonts].filter(
      (font) => {
        const familyName = normalizeFontFamilyName(font.name);
        if (familyNames.has(familyName)) return false;
        familyNames.add(familyName);
        return true;
      },
    );

    if (filterType !== 'all') {
      fonts = fonts.filter((f) => f.type === filterType);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      fonts = fonts.filter(
        (f) =>
          f.displayName.toLowerCase().includes(query) ||
          f.name.toLowerCase().includes(query),
      );
    }

    return fonts;
  })();

  const enabledFontNames = (() => {
    const names = [...builtinFonts, ...customFonts]
      .filter((font) => font.enabled)
      .map((font) => font.name);
    return new Set(names);
  })();

  const effectiveSelectedFont =
    selectedFont && enabledFontNames.has(selectedFont) ? selectedFont : null;

  const filterOptions = [
    { value: 'all', label: t('fontPicker.filterAll') || '전체' },
    { value: 'builtin', label: t('fontPicker.filterBuiltin') || '내장' },
    { value: 'web', label: t('fontPicker.filterWeb') || '웹' },
    { value: 'local', label: t('fontPicker.filterLocal') || '로컬' },
  ];

  // 퇴장 모션이 도는 동안 좌표를 유지한다
  const addMenuShown = useRetainedValue(addMenuPosition);

  const menuTargetFont =
    menu.renderKey !== null
      ? customFonts.find((font) => font.id === menu.renderKey) ?? null
      : null;

  const menuItems: ListItem[] = menuTargetFont
    ? [
        ...(menuTargetFont.type === 'web'
          ? [{ id: 'edit', label: t('fontPicker.edit') || '편집' }]
          : []),
        {
          id: 'rename',
          label: t('fontPicker.rename') || '이름 변경',
        },
        {
          id: 'toggle',
          // 상태를 체크로 보이면 이 목록에서 유일하게 체크 가능한 항목 하나 때문에
          // 나머지 행까지 체크 칸만큼 밀린다. 라벨이 직접 동작을 말하게 둔다
          label: menuTargetFont.enabled
            ? t('fontPicker.disable') || '비활성화'
            : t('fontPicker.enable') || '활성화',
          // 복원 실패로 파일 경로가 없는 로컬 폰트는 재활성화 불가
          disabled:
            menuTargetFont.type === 'local' && !menuTargetFont.localPath,
        },
        { id: 'delete', label: t('fontPicker.delete') || '삭제' },
      ]
    : [];

  const moreMenuLabel = (() => {
    const translated = t('common.more');
    return translated && translated !== 'common.more' ? translated : '더보기';
  })();

  const addMenuItems: ListItem[] = [
    {
      id: 'local',
      label: t('fontPicker.addLocalFont') || '로컬 폰트 추가',
    },
    {
      id: 'web',
      label: t('fontPicker.addWebFont') || '웹폰트 추가',
    },
  ];

  const handleDelete = async (font: CustomFont) => {
    const confirmed = await window.api.ui.dialog.confirm(
      t('fontPicker.deleteConfirm') ||
        '폰트를 삭제하시겠습니까? 이 폰트를 사용 중인 요소는 기본 폰트로 표시됩니다.',
      {
        confirmText: t('contextMenu.delete') || '삭제',
        cancelText: t('common.cancel') || '취소',
        danger: true,
      },
    );

    if (!confirmed) return;
    fontLibrary.removeFont(font.id);
  };

  const commitRename = (font: CustomFont) => {
    const trimmed = renameValue.trim();
    setRenamingFontId(null);
    if (!trimmed || trimmed === font.displayName) return;
    fontLibrary.renameFont(font.id, trimmed);
  };

  const openWebFontModal = (editingId: string | null) => {
    preloadWebFontEditor();
    startTransition(() => {
      setWebFontModal({ editingId });
    });
  };

  return (
    <>
      <CommonListPickerPage<CustomFont>
        open={open}
        pageTitle={pageTitle}
        onBack={onBack}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={t('fontPicker.searchPlaceholder') || '검색...'}
        filterOptions={filterOptions}
        filterValue={filterType}
        onFilterChange={(value) => setFilterType(value as FilterType)}
        items={filteredFonts}
        renderItem={(font) => {
          const isSelected = effectiveSelectedFont
            ? effectiveSelectedFont === font.name
            : font.name === DEFAULT_FONT_FAMILY;
          const isCustom = font.type !== 'builtin';
          const isDisabled = !font.enabled;
          const fontFamily = isDisabled
            ? `${getFontPickerPreviewFamily(font.name)}, ${font.name}`
            : font.name;

          return (
            <div
              key={font.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isDisabled) onFontSelect(font.name);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!isDisabled) onFontSelect(font.name);
                }
              }}
              onContextMenu={
                isCustom
                  ? (event) => menu.openFromContextMenu(event, font.id)
                  : undefined
              }
              className={`${pickerRowClass} ${
                isSelected
                  ? 'bg-fill-hover text-fg cursor-pointer'
                  : isDisabled
                  ? 'text-fg-faint hover:bg-fill cursor-default'
                  : 'text-fg hover:bg-fill cursor-pointer'
              }`}
              title={font.displayName}
            >
              {renamingFontId === font.id ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="min-w-0 flex-1 bg-transparent border-none p-0 outline-none text-label text-fg caret-accent"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => {
                    if (!renameCancelledRef.current) commitRename(font);
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
                      setRenamingFontId(null);
                    }
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-left"
                  style={{ fontFamily }}
                >
                  {font.displayName}
                </span>
              )}

              {isCustom ? (
                <button
                  type="button"
                  className={`${pickerMoreButtonClass} ${
                    isSelected || menu.menuKey === font.id
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
                    menu.capturePressState(font.id);
                  }}
                  onClick={(event) => menu.openFromButton(event, font.id)}
                >
                  <MoreVerticalIcon />
                </button>
              ) : null}
            </div>
          );
        }}
        emptyText={t('fontPicker.noFonts') || '폰트 없음'}
        onAdd={(event) => {
          if (addMenuPosition) {
            setAddMenuPosition(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAddMenuPosition({ x: rect.right + 4, y: rect.top - 2 });
        }}
        addLabel={t('fontPicker.add')}
        addRowPlacement="start"
        addButtonRef={addButtonRef}
      />

      {addMenuShown && (
        <ListPopup
          open={addMenuPosition !== null}
          ariaLabel={t('fontPicker.add')}
          referenceRef={addButtonRef}
          position={addMenuShown}
          onClose={() => setAddMenuPosition(null)}
          items={addMenuItems}
          onSelect={(id) => {
            setAddMenuPosition(null);
            if (id === 'local') {
              void fontLibrary.addLocalFont();
            } else if (id === 'web') {
              openWebFontModal(null);
            }
          }}
          offsetX={0}
          offsetY={0}
        />
      )}

      {menu.renderKey !== null && (
        <ListPopup
          open={menu.menuKey !== null}
          ariaLabel={t('common.more')}
          position={menu.renderPosition ?? undefined}
          onClose={menu.close}
          items={menuItems}
          onSelect={(id) => {
            const font = menuTargetFont;
            menu.close();
            if (!font) return;
            if (id === 'edit') {
              openWebFontModal(font.id);
            } else if (id === 'rename') {
              renameCancelledRef.current = false;
              setRenameValue(font.displayName);
              setRenamingFontId(font.id);
            } else if (id === 'toggle') {
              fontLibrary.toggleFont(font.id, !font.enabled);
            } else if (id === 'delete') {
              void handleDelete(font);
            }
          }}
          offsetX={0}
          offsetY={0}
        />
      )}

      {webFontModal ? (
        <WebFontEditorSheet
          editingId={webFontModal.editingId}
          onDone={() => setWebFontModal(null)}
        />
      ) : null}
    </>
  );
};

export default FontPicker;
