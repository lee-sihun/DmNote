import React, {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { useTranslation } from "@contexts/I18nContext";
import { useLenis } from "@hooks/useLenis";
import FloatingPopup from "../FloatingPopup";
import Dropdown from "@components/main/common/Dropdown";
import { useFontStore } from "@stores/useFontStore";
import type { CustomFont, FontType } from "@src/types/fonts";
import PlusIcon from "@assets/svgs/plus2.svg";

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

type FilterType = "all" | "builtin" | "local" | "web";
const SCROLL_CONTENT_GUTTER = 4;

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
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [hasOverflow, setHasOverflow] = useState(false);
  const pickerContainerRef = useRef<HTMLDivElement>(null);
  const [fixedPosition, setFixedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const { builtinFonts, customFonts } = useFontStore();

  // Lenis smooth scroll 적용
  const {
    scrollContainerRef: scrollRef,
    wrapperElement,
    lenisInstance,
    scrollbarWidth,
  } = useLenis();

  // 필터링된 폰트 목록
  const filteredFonts = useMemo(() => {
    let fonts: CustomFont[] = [...builtinFonts, ...customFonts].filter(
      (f) => f.enabled,
    );

    // 타입 필터
    if (filterType !== "all") {
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
      { value: "all", label: t("fontPicker.filterAll") || "전체" },
      { value: "builtin", label: t("fontPicker.filterBuiltin") || "내장" },
      { value: "web", label: t("fontPicker.filterWeb") || "웹" },
      { value: "local", label: t("fontPicker.filterLocal") || "로컬" },
    ],
    [t],
  );

  // 고정 위치 계산 (ImagePicker와 동일한 로직)
  useLayoutEffect(() => {
    if (!open) {
      setFixedPosition(null);
      return;
    }

    if (panelElement) {
      requestAnimationFrame(() => {
        const panelRect = panelElement.getBoundingClientRect();
        const pickerEl = pickerContainerRef.current;
        const pickerWidth = pickerEl ? pickerEl.offsetWidth : 164;
        const pickerHeight = pickerEl ? pickerEl.offsetHeight : 280;

        const colorPickerSolidHeight = 264;
        const gap = 5;
        const padding = 5;

        let fixedX = panelRect.left - pickerWidth - gap;
        if (fixedX < padding) {
          fixedX = padding;
        }

        const panelBottomPadding = 20;
        const solidPickerBottom = panelRect.bottom - panelBottomPadding;
        let fixedY = solidPickerBottom - pickerHeight;
        if (fixedY < padding) {
          fixedY = padding;
        }

        setFixedPosition({ x: fixedX, y: fixedY });
      });
    } else {
      setFixedPosition(null);
    }
  }, [open, panelElement]);

  const effectiveOffsetY = fixedPosition ? 0 : -93;

  const handleFontClick = useCallback(
    (font: CustomFont) => {
      onFontSelect(font.name);
    },
    [onFontSelect],
  );

  useEffect(() => {
    if (!open) return;
    const rafId = requestAnimationFrame(() => {
      lenisInstance.current?.resize?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, filteredFonts.length, filterType, searchQuery, lenisInstance]);

  useEffect(() => {
    if (!open) {
      setHasOverflow(false);
      return;
    }

    const wrapper = wrapperElement;
    if (!wrapper) return;

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
  }, [open, wrapperElement, filteredFonts.length]);

  const scrollbarCompensation = hasOverflow
    ? scrollbarWidth + SCROLL_CONTENT_GUTTER
    : 0;

  return (
    <FloatingPopup
      open={open}
      referenceRef={referenceRef}
      fixedX={fixedPosition?.x}
      fixedY={fixedPosition?.y}
      placement="right-start"
      offset={32}
      offsetY={effectiveOffsetY}
      className="z-50"
      interactiveRefs={interactiveRefs}
      onClose={onClose}
      autoClose={false}
    >
      <div
        ref={pickerContainerRef}
        className="flex flex-col p-[8px] gap-[8px] w-[156px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30]"
      >
        {/* 검색 입력 */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("fontPicker.searchPlaceholder") || "검색..."}
          className="w-full h-[23px] px-[8px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] text-[#DBDEE8] text-style-2 placeholder-[#6F6E7A] focus:border-[#459BF8] outline-none"
        />

        {/* 필터 드롭다운 */}
        <Dropdown
          options={filterOptions}
          value={filterType}
          onChange={(value) => setFilterType(value as FilterType)}
          fullWidth
        />

        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        {/* 폰트 리스트 */}
        <div
          ref={scrollRef}
          className="flex flex-col gap-[4px] min-h-[120px] h-[120px] overflow-y-auto modal-content-scroll"
          style={{
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
            className="flex flex-col gap-[4px]"
            style={
              hasOverflow
                ? { width: `calc(100% - ${SCROLL_CONTENT_GUTTER}px)` }
                : undefined
            }
          >
            {filteredFonts.length === 0 ? (
              <div className="flex items-center justify-center py-[10px] text-[#6F6E7A] text-style-4">
                {t("fontPicker.noFonts") || "폰트 없음"}
              </div>
            ) : (
              filteredFonts.map((font) => {
                // 폰트가 선택되지 않았을 때 기본 폰트(SUIT-Regular)를 선택된 것으로 표시
                const isSelected = effectiveSelectedFont
                  ? effectiveSelectedFont === font.name
                  : font.name === "SUIT-Regular";
                return (
                  <button
                    key={font.id}
                    type="button"
                    className={`w-full min-h-[24px] h-[24px] flex-shrink-0 px-[8px] rounded-[7px] text-left text-style-4 transition-colors truncate ${
                      isSelected
                        ? "bg-[#2E2D33] text-[#FFFFFF]"
                        : "text-[#DBDEE8] hover:bg-[#26262C]"
                    }`}
                    style={{ fontFamily: font.name }}
                    onClick={() => handleFontClick(font)}
                    title={font.displayName}
                  >
                    {font.displayName}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 구분선 */}
        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        {/* 폰트 추가 버튼 (탭 추가 버튼 스타일) */}
        <button
          type="button"
          className="w-full h-[23px] flex items-center justify-center rounded-[7px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] transition-colors"
          onClick={onOpenManager}
        >
          <PlusIcon />
        </button>
      </div>
    </FloatingPopup>
  );
}
