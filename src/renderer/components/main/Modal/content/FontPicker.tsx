import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '@contexts/I18nContext';
import { useFontStore } from '@stores/useFontStore';
import type { CustomFont } from '@src/types/fonts';
import PlusIcon from '@assets/svgs/plus2.svg';
import CommonListPickerPopup from './CommonListPickerPopup';

interface FontPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  selectedFont: string | null;
  onFontSelect: (fontName: string | null) => void;
  onClose: () => void;
  onOpenManager: () => void;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
}

type FilterType = 'all' | 'builtin' | 'local' | 'web';

export default function FontPicker({
  open,
  referenceRef,
  panelElement = null,
  selectedFont,
  onFontSelect,
  onClose,
  onOpenManager,
  interactiveRefs = [],
}: FontPickerProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');

  const { builtinFonts, customFonts } = useFontStore();

  // 필터링된 폰트 목록
  const filteredFonts = useMemo(() => {
    let fonts: CustomFont[] = [...builtinFonts, ...customFonts].filter(
      (f) => f.enabled,
    );

    // 타입 필터
    if (filterType !== 'all') {
      fonts = fonts.filter((f) => f.type === filterType);
    }

    // 검색 필터
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      fonts = fonts.filter(
        (f) =>
          f.displayName.toLowerCase().includes(query) ||
          f.name.toLowerCase().includes(query),
      );
    }

    return fonts;
  }, [builtinFonts, customFonts, filterType, searchQuery]);

  const enabledFontNames = useMemo(() => {
    const names = [...builtinFonts, ...customFonts]
      .filter((font) => font.enabled)
      .map((font) => font.name);
    return new Set(names);
  }, [builtinFonts, customFonts]);

  const effectiveSelectedFont =
    selectedFont && enabledFontNames.has(selectedFont) ? selectedFont : null;

  // 필터 옵션
  const filterOptions = useMemo(
    () => [
      { value: 'all', label: t('fontPicker.filterAll') || '전체' },
      { value: 'builtin', label: t('fontPicker.filterBuiltin') || '내장' },
      { value: 'web', label: t('fontPicker.filterWeb') || '웹' },
      { value: 'local', label: t('fontPicker.filterLocal') || '로컬' },
    ],
    [t],
  );

  const handleFontClick = useCallback(
    (font: CustomFont) => {
      onFontSelect(font.name);
    },
    [onFontSelect],
  );

  return (
    <CommonListPickerPopup<CustomFont>
      open={open}
      referenceRef={referenceRef}
      panelElement={panelElement}
      interactiveRefs={interactiveRefs}
      onClose={onClose}
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
          : font.name === 'SUIT-Regular';
        return (
          <button
            key={font.id}
            type="button"
            className={`w-full min-h-[24px] h-[24px] flex-shrink-0 px-[8px] rounded-[7px] text-left text-style-4 transition-colors truncate ${
              isSelected
                ? 'bg-[#2E2D33] text-[#FFFFFF]'
                : 'text-[#DBDEE8] hover:bg-[#26262C]'
            }`}
            style={{ fontFamily: font.name }}
            onClick={() => handleFontClick(font)}
            title={font.displayName}
          >
            {font.displayName}
          </button>
        );
      }}
      emptyText={t('fontPicker.noFonts') || '폰트 없음'}
      onAdd={onOpenManager}
      addButtonContent={<PlusIcon />}
    />
  );
}
