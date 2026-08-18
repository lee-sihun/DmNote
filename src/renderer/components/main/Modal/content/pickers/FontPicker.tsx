import {
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useFontStore } from '@stores/useFontStore';
import type { CustomFont } from '@src/types/settings/fonts';
import {
  DEFAULT_FONT_FAMILY,
  buildDraftPreviewCss,
} from '@src/types/settings/fonts';
import { convertFileSrc } from '@tauri-apps/api/core';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import RenderErrorBoundary from '@components/main/common/RenderErrorBoundary';
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

interface FontPickerProps {
  open: boolean;
  selectedFont: string | null;
  onFontSelect: (fontName: string | null) => void;
  pageTitle: string;
  onBack: () => void;
}

type FilterType = 'all' | 'builtin' | 'local' | 'web';

let webFontInputModalPreloadPromise: Promise<
  typeof import('./WebFontInputModal')
> | null = null;

const preloadWebFontInputModal = () => {
  if (!webFontInputModalPreloadPromise) {
    webFontInputModalPreloadPromise = import('./WebFontInputModal');
  }
  return webFontInputModalPreloadPromise;
};

// 청크 로드가 실패하면 lazy는 그 실패를 영구히 기억한다. 다시 시도하려면
// import 프라미스와 lazy 래퍼를 둘 다 새로 만들어야 한다
const createLazyWebFontInputModal = () => lazy(preloadWebFontInputModal);

const resetWebFontInputModalLoader = () => {
  webFontInputModalPreloadPromise = null;
};

// preview용 font-family 이름 (syncFontCSS가 주입하는 원본 이름과 분리)
const getPreviewFontFamily = (fontName: string) => `${fontName}__preview`;

const injectPreviewCSS = (id: string, css: string) => {
  const styleId = `fontpreview-${id}`;
  const existing = document.getElementById(styleId);
  if (existing) {
    existing.textContent = css;
  } else {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }
};

const removePreviewCSS = (id: string) => {
  const style = document.getElementById(`fontpreview-${id}`);
  if (style) style.remove();
};

const buildPreviewCSS = (font: CustomFont): string | null => {
  const previewFontFamily = getPreviewFontFamily(font.name);

  if (font.type === 'local' && font.localPath) {
    const url = convertFileSrc(font.localPath);
    const ext = font.localPath.split('.').pop()?.toLowerCase() ?? '';
    const format =
      ext === 'otf'
        ? 'opentype'
        : ext === 'woff'
        ? 'woff'
        : ext === 'woff2'
        ? 'woff2'
        : 'truetype';
    return `@font-face {\n  font-family: '${previewFontFamily}';\n  src: url('${url}') format('${format}');\n  font-weight: normal;\n  font-style: normal;\n  font-display: swap;\n}`;
  }

  if (font.type === 'web' && font.cssContent) {
    // @font-face 블록만 추출해 미리보기 이름으로 치환 — 원문 전체를 주입하면
    // 블록 밖 전역 규칙(body{display:none} 등)과 다른 face까지 앱에 새어든다.
    // 저장 경로(useFontLibrary)의 validator와 동일한 추출기를 재사용
    return buildDraftPreviewCss(font.cssContent, previewFontFamily) || null;
  }

  return null;
};

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
  // cycle은 실패한 경계를 새로 마운트하는 key. 로더와 함께 갈린다
  const [webFontEditorLoader, setWebFontEditorLoader] = useState(() => ({
    cycle: 0,
    Component: createLazyWebFontInputModal(),
  }));
  const { cycle: webFontEditorCycle, Component: LazyWebFontInputModal } =
    webFontEditorLoader;
  const [renamingFontId, setRenamingFontId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const { builtinFonts, customFonts } = useFontStore();
  const fontLibrary = useFontLibrary();
  const menu = usePickerItemMenu<string>();

  // 비활성 폰트도 목록에서 실제 서체로 보이도록 preview CSS 주입
  // (활성 폰트는 syncFontCSS가 원본 이름으로 주입)
  const previewIdsRef = useRef<Set<string>>(new Set());
  const previewCssCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open) return;

    const nextPreviewIds = new Set<string>();
    customFonts
      .filter((font) => !font.enabled)
      .forEach((font) => {
        const css = buildPreviewCSS(font);
        if (!css) return;

        nextPreviewIds.add(font.id);
        if (previewCssCacheRef.current.get(font.id) !== css) {
          injectPreviewCSS(font.id, css);
          previewCssCacheRef.current.set(font.id, css);
        }
      });

    previewIdsRef.current.forEach((id) => {
      if (!nextPreviewIds.has(id)) {
        removePreviewCSS(id);
        previewCssCacheRef.current.delete(id);
      }
    });

    previewIdsRef.current = nextPreviewIds;
  }, [open, customFonts]);

  // 언마운트 시 주입된 preview CSS 정리 (피커는 닫히면 언마운트됨)
  useEffect(() => {
    return () => {
      // 주입 effect가 Set을 재할당하므로 언마운트 시점의 ref를 읽어야 함
      previewIdsRef.current.forEach((id) => removePreviewCSS(id));
    };
  }, []);

  // 이름 변경 시작 시 입력에 포커스
  useEffect(() => {
    if (renamingFontId === null) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingFontId]);

  // 피커가 열려 있는 동안 WebFontInputModal 코드를 미리 로드
  useEffect(() => {
    if (!open) return;
    void preloadWebFontInputModal();
  }, [open]);

  // 필터링된 폰트 목록 (비활성 폰트도 노출 — 행에서 흐리게 표시)
  const filteredFonts = (() => {
    let fonts: CustomFont[] = [...builtinFonts, ...customFonts];

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
          label: t('fontPicker.enabledToggle') || '활성화',
          checked: menuTargetFont.enabled,
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

  const editingWebFont =
    webFontModal?.editingId != null
      ? customFonts.find(
          (font) => font.type === 'web' && font.id === webFontModal.editingId,
        ) ?? null
      : null;

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
    // 실패는 렌더 시점에 lazy가 다시 던지고 경계가 받는다. 여기선 로그 소음만 막는다
    preloadWebFontInputModal().catch(() => {});
    startTransition(() => {
      setWebFontModal({ editingId });
    });
  };

  // 청크를 못 불러오면 창 루트가 아니라 시트만 접는다. 다음 열기가 새로 시도하도록
  // 로더를 갈아 끼운다
  const handleWebFontModalLoadError = (error: unknown) => {
    console.error('Failed to load web font editor', error);
    resetWebFontInputModalLoader();
    setWebFontEditorLoader((prev) => ({
      cycle: prev.cycle + 1,
      Component: createLazyWebFontInputModal(),
    }));
    setWebFontModal(null);
    void window.api.ui.dialog
      .alert(t('fontPicker.editorLoadFailed'), {
        confirmText: t('common.ok'),
      })
      .catch(() => {});
  };

  const handleWebFontSubmit = (css: string, displayName: string) => {
    const ok = fontLibrary.submitWebFont(
      css,
      displayName,
      webFontModal?.editingId ?? null,
    );
    if (ok) setWebFontModal(null);
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
            ? `${getPreviewFontFamily(font.name)}, ${font.name}`
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

      <RenderErrorBoundary
        key={webFontEditorCycle}
        onError={handleWebFontModalLoadError}
      >
        <Suspense fallback={null}>
          {webFontModal ? (
            <LazyWebFontInputModal
              isOpen
              onClose={() => setWebFontModal(null)}
              onSubmit={handleWebFontSubmit}
              initialCss={editingWebFont?.cssContent || ''}
              mode={editingWebFont ? 'edit' : 'add'}
              isDuplicateFontFamily={(fontFamily) =>
                fontLibrary.isDuplicateFontFamily(fontFamily, {
                  excludeId: webFontModal.editingId,
                })
              }
              t={t}
            />
          ) : null}
        </Suspense>
      </RenderErrorBoundary>
    </>
  );
};

export default FontPicker;
