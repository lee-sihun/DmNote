import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useFontStore } from '@stores/useFontStore';
import type { CustomFont } from '@src/types/settings/fonts';
import { DEFAULT_FONT_FAMILY } from '@src/types/settings/fonts';
import { convertFileSrc } from '@tauri-apps/api/core';
import Modal from '@components/main/Modal/Modal';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import CommonListPickerPopup from './CommonListPickerPopup';
import { pickerRowClass, pickerMoreButtonClass } from './pickerRowClass';
import MoreVerticalIcon from './MoreVerticalIcon';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import { useFontLibrary } from '@hooks/useFontLibrary';

interface FontPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  selectedFont: string | null;
  onFontSelect: (fontName: string | null) => void;
  onClose: () => void;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  // 페이지 모드 패스스루 — 패널 서브 페이지로 렌더할 때 사용
  renderMode?: 'popup' | 'page';
  pageTitle?: string;
  onBack?: () => void;
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

const LazyWebFontInputModal = lazy(preloadWebFontInputModal);

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
    // 웹폰트 CSS에서 font-family를 preview 이름으로 교체
    return font.cssContent.replace(
      /font-family:\s*['"]?([^'";]+)['"]?\s*;/i,
      `font-family: '${previewFontFamily}';`,
    );
  }

  return null;
};

const FontPicker = ({
  open,
  referenceRef,
  panelElement = null,
  selectedFont,
  onFontSelect,
  onClose,
  interactiveRefs = [],
  renderMode = 'popup',
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

    const timer = window.setTimeout(() => {
      void preloadWebFontInputModal();
    }, 120);

    return () => window.clearTimeout(timer);
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

  const menuTargetFont =
    menu.menuKey !== null
      ? customFonts.find((font) => font.id === menu.menuKey) ?? null
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
    void preloadWebFontInputModal();
    setWebFontModal({ editingId });
  };

  const handleWebFontSubmit = (css: string, displayName: string) => {
    const ok = fontLibrary.submitWebFont(
      css,
      displayName,
      webFontModal?.editingId ?? null,
    );
    if (ok) setWebFontModal(null);
  };

  const handlePickerClose = () => {
    if (menu.menuKey !== null || addMenuPosition !== null) return;
    onClose();
  };

  return (
    <>
      <CommonListPickerPopup<CustomFont>
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
        estimatedHeight={280}
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
              className={`${pickerRowClass(renderMode)} ${
                isSelected
                  ? 'bg-surface-active text-fg cursor-pointer'
                  : isDisabled
                  ? 'text-fg-faint hover:bg-surface-hover cursor-default'
                  : 'text-fg hover:bg-surface-hover cursor-pointer'
              }`}
              title={font.displayName}
            >
              {renamingFontId === font.id ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="min-w-0 flex-1 bg-transparent border-none p-0 outline-none text-style-4 text-fg caret-accent"
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
                  className={`${pickerMoreButtonClass(renderMode)} ${
                    isSelected || menu.menuKey === font.id
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
        addLabel={t('fontPicker.add') || '폰트 추가'}
        addButtonRef={addButtonRef}
      />

      {addMenuPosition !== null && (
        <ListPopup
          open
          referenceRef={addButtonRef}
          position={addMenuPosition}
          onClose={() => setAddMenuPosition(null)}
          textAlign="center"
          items={addMenuItems}
          onSelect={(id) => {
            setAddMenuPosition(null);
            if (id === 'local') {
              void fontLibrary.addLocalFont();
            } else if (id === 'web') {
              openWebFontModal(null);
            }
          }}
          className="z-[60]"
          offsetX={0}
          offsetY={0}
        />
      )}

      {menu.menuKey !== null && (
        <ListPopup
          open
          position={menu.menuPosition ?? undefined}
          onClose={menu.close}
          textAlign="center"
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
          className="z-[60]"
          offsetX={0}
          offsetY={0}
        />
      )}

      {/* 웹폰트 CSS 입력 모달 */}
      {webFontModal ? (
        <Suspense
          fallback={
            <Modal onClick={() => setWebFontModal(null)}>
              <div
                className="w-[640px] max-w-[calc(100vw-80px)] h-[335px] flex items-center justify-center bg-elevated rounded-[10px]"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="text-body leading-[16px] text-fg-muted">
                  로딩 중...
                </p>
              </div>
            </Modal>
          }
        >
          <LazyWebFontInputModal
            isOpen
            onClose={() => setWebFontModal(null)}
            onSubmit={handleWebFontSubmit}
            initialCss={editingWebFont?.cssContent || ''}
            isDuplicateFontFamily={(fontFamily) =>
              fontLibrary.isDuplicateFontFamily(fontFamily, {
                excludeId: webFontModal.editingId,
              })
            }
            t={t}
          />
        </Suspense>
      ) : null}
    </>
  );
};

export default FontPicker;
