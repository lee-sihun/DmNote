import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyCounterAnimationSettings, KeyCounterSettings } from "@src/types/keys";
import type {
  CounterAnimationListResponse,
  CounterAnimationPreset,
} from "@src/types/counterAnimation";
import {
  applyPresetToAnimation,
  findMatchingPresetId,
  normalizeCounterAnimationLibrary,
} from "@src/types/counterAnimation";
import ListPopup, { type ListItem } from "@components/main/Modal/ListPopup";
import CommonListPickerPopup from "./CommonListPickerPopup";
import CounterAnimationEditorModal from "./CounterAnimationEditorModal";
import PlusIcon from "@assets/svgs/plus2.svg";

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
}

type FilterType = "all" | "builtin" | "user";
type EditorState =
  | { mode: "create"; preset: null }
  | { mode: "edit"; preset: CounterAnimationPreset };

const MoreVerticalIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="6" cy="2.5" r="1" fill="currentColor" />
    <circle cx="6" cy="6" r="1" fill="currentColor" />
    <circle cx="6" cy="9.5" r="1" fill="currentColor" />
  </svg>
);

const EMPTY_LIBRARY: CounterAnimationListResponse = {
  builtinPresets: [],
  userPresets: [],
};

export default function CounterAnimationPicker({
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
}: CounterAnimationPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [library, setLibrary] = useState<CounterAnimationListResponse>(EMPTY_LIBRARY);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [actionMenuPresetId, setActionMenuPresetId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    setErrorText("");
    try {
      const response = await window.api.counterAnimation.list();
      setLibrary(normalizeCounterAnimationLibrary(response));
    } catch (error) {
      console.error("Failed to load counter animation presets", error);
      setErrorText(
        t("counterSetting.loadAnimationFailed") ||
          "애니메이션 목록을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void loadLibrary();
  }, [loadLibrary, open]);

  useEffect(() => {
    if (open) return;
    setActionMenuPresetId(null);
    setActionMenuPosition(null);
  }, [open]);

  const allPresets = useMemo(
    () => [...library.builtinPresets, ...library.userPresets],
    [library],
  );

  const selectedPresetId = useMemo(
    () => findMatchingPresetId(animation, library),
    [animation, library],
  );

  const filterOptions = useMemo(
    () => [
      {
        value: "all",
        label: t("counterSetting.filterAll") || "전체",
      },
      {
        value: "builtin",
        label: t("counterSetting.filterBuiltin") || "내장",
      },
      {
        value: "user",
        label: t("counterSetting.filterUser") || "사용자정의",
      },
    ],
    [t],
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return allPresets.filter((preset) => {
      if (filterType !== "all" && preset.source !== filterType) {
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
  }, [allPresets, filterType, searchQuery, t]);

  const handlePresetSelect = useCallback(
    (preset: CounterAnimationPreset) => {
      setActionMenuPresetId(null);
      onAnimationChange(applyPresetToAnimation(animation, preset));
    },
    [animation, onAnimationChange],
  );

  const handleDeletePreset = useCallback(
    async (preset: CounterAnimationPreset) => {
      const confirmed = await window.api.ui.dialog.confirm(
        t("counterSetting.deleteAnimationConfirm") ||
          "애니메이션을 삭제하시겠습니까?",
        {
          confirmText: t("contextMenu.delete") || "삭제",
          cancelText: t("common.cancel") || "취소",
          danger: true,
        },
      );

      if (!confirmed) return;

      try {
        await window.api.counterAnimation.remove(preset.id);
        await loadLibrary();
      } catch (error) {
        console.error("Failed to delete counter animation preset", error);
        setErrorText(
          t("counterSetting.deleteAnimationFailed") ||
            "애니메이션 삭제에 실패했습니다.",
        );
      }
    },
    [loadLibrary, t],
  );

  const openCreateModal = useCallback(() => {
    setEditorState({ mode: "create", preset: null });
  }, []);

  const openEditModal = useCallback((preset: CounterAnimationPreset) => {
    setActionMenuPresetId(null);
    setActionMenuPosition(null);
    setEditorState({ mode: "edit", preset });
  }, []);

  const menuItems = useMemo<ListItem[]>(
    () => [
      {
        id: "edit",
        label: t("counterSetting.editAnimation") || "편집",
      },
      {
        id: "delete",
        label: t("counterSetting.deleteAnimation") || "삭제",
      },
    ],
    [t],
  );
  const moreMenuLabel = useMemo(() => {
    const translated = t("common.more");
    return translated && translated !== "common.more" ? translated : "더보기";
  }, [t]);

  const handleEditorSaved = useCallback(
    async ({
      preset,
      mode,
    }: {
      preset: CounterAnimationPreset;
      mode: "create" | "edit";
      affectedUsageCount: number;
    }) => {
      await loadLibrary();
      if (mode === "create" || selectedPresetId === preset.id) {
        onAnimationChange(applyPresetToAnimation(animation, preset));
      }
    },
    [animation, loadLibrary, onAnimationChange, selectedPresetId],
  );

  const handlePickerClose = useCallback(() => {
    if (actionMenuPresetId !== null) return;
    onClose();
  }, [actionMenuPresetId, onClose]);

  return (
    <>
      <CommonListPickerPopup<CounterAnimationPreset>
        open={open}
        referenceRef={referenceRef}
        panelElement={panelElement}
        interactiveRefs={interactiveRefs}
        onClose={handlePickerClose}
        widthClass="w-[156px]"
        estimatedWidth={164}
        estimatedHeight={276}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={t("counterSetting.searchAnimationPlaceholder") || "검색"}
        filterOptions={filterOptions}
        filterValue={filterType}
        onFilterChange={(value) => setFilterType(value as FilterType)}
        items={filteredItems}
        getItemKey={(item) => item.id}
        renderItem={(preset) => {
          const isSelected = selectedPresetId === preset.id;
          const isUserPreset = preset.source === "user";
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
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handlePresetSelect(preset);
                }
              }}
              className={`w-full h-[24px] px-[8px] rounded-[7px] text-style-4 transition-colors flex items-center gap-[4px] cursor-pointer group ${
                isSelected
                  ? "bg-[#2E2D33] text-[#FFFFFF]"
                  : "text-[#DBDEE8] hover:bg-[#26262C]"
              }`}
              title={displayName}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {displayName}
              </span>

              {isUserPreset ? (
                <button
                  type="button"
                  className={`w-[18px] h-[18px] rounded-[5px] transition-all flex items-center justify-center shrink-0 ${
                    isSelected || actionMenuPresetId === preset.id
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  } ${
                    isSelected
                      ? "text-[#D9DCE6] hover:text-[#FFFFFF] hover:bg-[#3A3943]"
                      : "text-[#8A8D99] hover:text-[#DBDEE8] hover:bg-[#2A2A30]"
                  }`}
                  title={moreMenuLabel}
                  aria-label={moreMenuLabel}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (actionMenuPresetId === preset.id) {
                      setActionMenuPresetId(null);
                      setActionMenuPosition(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setActionMenuPosition({
                      x: rect.right + 4,
                      y: rect.top - 2,
                    });
                    setActionMenuPresetId(preset.id);
                  }}
                >
                  <MoreVerticalIcon />
                </button>
              ) : null}
            </div>
          );
        }}
        emptyText={
          t("counterSetting.noAnimations") || "등록된 애니메이션이 없습니다"
        }
        isLoading={isLoading}
        loadingText={t("propertiesPanel.loading") || "로딩..."}
        errorText={errorText}
        onAdd={openCreateModal}
        addButtonContent={<PlusIcon />}
      />

      {actionMenuPresetId !== null && (
        <ListPopup
          open
          position={actionMenuPosition ?? undefined}
          onClose={() => {
            setActionMenuPresetId(null);
            setActionMenuPosition(null);
          }}
          textAlign="center"
          items={menuItems}
          onSelect={(id) => {
            const preset = allPresets.find((p) => p.id === actionMenuPresetId);
            if (!preset) return;
            if (id === "edit") {
              openEditModal(preset);
            } else if (id === "delete") {
              void handleDeletePreset(preset);
            }
            setActionMenuPresetId(null);
            setActionMenuPosition(null);
          }}
          className="z-[60]"
          offsetX={0}
          offsetY={0}
        />
      )}

      <CounterAnimationEditorModal
        isOpen={!!editorState}
        mode={editorState?.mode || "create"}
        initialPreset={editorState?.preset || null}
        counterSettings={counterSettings}
        keyVisual={keyVisual}
        onClose={() => setEditorState(null)}
        onSaved={handleEditorSaved}
        t={t}
      />
    </>
  );
}
