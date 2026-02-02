import { useCallback } from "react";
import type { KeyPosition, NoteColor, KeyCounterSettings } from "@src/types/keys";
import { normalizeCounterSettings } from "@src/types/keys";
import type { StatItemPosition } from "@src/types/statItems";

const DEFAULT_ACTIVE_BACKGROUND_COLOR = "rgba(121, 121, 121, 0.9)";
const DEFAULT_ACTIVE_BORDER_COLOR = "rgba(255, 255, 255, 0.9)";
const DEFAULT_ACTIVE_FONT_COLOR = "#FFFFFF";

type KeyLikeType = "key" | "stat";

interface SelectedElement {
  type: KeyLikeType;
  index?: number;
}

interface UseBatchHandlersProps {
  selectedKeyLikeElements: SelectedElement[];
  keyPositions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  selectedKeyType: string;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyBatchPreview?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onStatUpdate: (data: Partial<StatItemPosition> & { index: number }) => void;
  onStatBatchUpdate?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => void;
  onStatPreview?: (
    index: number,
    updates: Partial<StatItemPosition>,
  ) => void;
  onStatBatchPreview?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => void;
}

export function useBatchHandlers({
  selectedKeyLikeElements,
  keyPositions,
  statPositions,
  selectedKeyType,
  onKeyUpdate,
  onKeyBatchUpdate,
  onKeyPreview,
  onKeyBatchPreview,
  onStatUpdate,
  onStatBatchUpdate,
  onStatPreview,
  onStatBatchPreview,
}: UseBatchHandlersProps) {
  const selectedKeys = selectedKeyLikeElements.filter((el) => el.type === "key");
  const selectedStats = selectedKeyLikeElements.filter(
    (el) => el.type === "stat",
  );

  const getKeyLikePosition = useCallback(
    (type: KeyLikeType, index: number) => {
      if (type === "key") return keyPositions[selectedKeyType]?.[index] ?? null;
      return statPositions[selectedKeyType]?.[index] ?? null;
    },
    [keyPositions, statPositions, selectedKeyType],
  );

  const dispatchKeyUpdates = useCallback(
    (updates: Array<{ index: number } & Partial<KeyPosition>>, kind: "preview" | "commit") => {
      if (updates.length === 0) return;
      if (kind === "preview") {
        if (onKeyBatchPreview) {
          onKeyBatchPreview(updates);
          return;
        }
        if (onKeyPreview) {
          updates.forEach(({ index, ...rest }) => onKeyPreview(index, rest));
          return;
        }
        return;
      }

      if (onKeyBatchUpdate) {
        onKeyBatchUpdate(updates);
        return;
      }
      updates.forEach((update) => onKeyUpdate(update));
    },
    [onKeyBatchPreview, onKeyPreview, onKeyBatchUpdate, onKeyUpdate],
  );

  const dispatchStatUpdates = useCallback(
    (
      updates: Array<{ index: number } & Partial<StatItemPosition>>,
      kind: "preview" | "commit",
    ) => {
      if (updates.length === 0) return;
      if (kind === "preview") {
        if (onStatBatchPreview) {
          onStatBatchPreview(updates);
          return;
        }
        if (onStatPreview) {
          updates.forEach(({ index, ...rest }) => onStatPreview(index, rest));
          return;
        }
        // preview 핸들러가 없으면 즉시 반영
        updates.forEach((update) => onStatUpdate(update));
        return;
      }

      if (onStatBatchUpdate) {
        onStatBatchUpdate(updates);
        return;
      }
      updates.forEach((update) => onStatUpdate(update));
    },
    [onStatBatchPreview, onStatPreview, onStatBatchUpdate, onStatUpdate],
  );

  // 스타일 변경 (프리뷰)
  const handleBatchStyleChange = useCallback(
    (property: keyof KeyPosition, value: any) => {
      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [property]: value })) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      dispatchKeyUpdates(keyUpdates, "preview");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [property]: value })) as Array<
        { index: number } & Partial<StatItemPosition>
      >;
      dispatchStatUpdates(statUpdates, "preview");
    },
    [dispatchKeyUpdates, dispatchStatUpdates, selectedKeys, selectedStats],
  );

  // 스타일 변경 완료 (저장)
  const handleBatchStyleChangeComplete = useCallback(
    (property: keyof KeyPosition, value: any) => {
      const currentKeys = keyPositions[selectedKeyType] || [];
      const currentStats = statPositions[selectedKeyType] || [];

      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const index = el.index!;
          const pos = currentKeys[index];
          if (pos) {
            if (property === "backgroundColor" && pos.activeBackgroundColor == null) {
              return {
                index,
                backgroundColor: value,
                activeBackgroundColor:
                  pos.activeBackgroundColor ??
                  pos.backgroundColor ??
                  DEFAULT_ACTIVE_BACKGROUND_COLOR,
              };
            }
            if (property === "borderColor" && pos.activeBorderColor == null) {
              return {
                index,
                borderColor: value,
                activeBorderColor:
                  pos.activeBorderColor ?? pos.borderColor ?? DEFAULT_ACTIVE_BORDER_COLOR,
              };
            }
            if (property === "fontColor" && pos.activeFontColor == null) {
              return {
                index,
                fontColor: value,
                activeFontColor: pos.activeFontColor ?? pos.fontColor ?? DEFAULT_ACTIVE_FONT_COLOR,
              };
            }
          }
          return { index, [property]: value } as { index: number } & Partial<KeyPosition>;
        });
      dispatchKeyUpdates(keyUpdates, "commit");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const index = el.index!;
          const pos = currentStats[index];
          if (pos) {
            if (property === "backgroundColor" && pos.activeBackgroundColor == null) {
              return {
                index,
                backgroundColor: value,
                activeBackgroundColor:
                  pos.activeBackgroundColor ??
                  pos.backgroundColor ??
                  DEFAULT_ACTIVE_BACKGROUND_COLOR,
              } as any;
            }
            if (property === "borderColor" && pos.activeBorderColor == null) {
              return {
                index,
                borderColor: value,
                activeBorderColor:
                  pos.activeBorderColor ?? pos.borderColor ?? DEFAULT_ACTIVE_BORDER_COLOR,
              } as any;
            }
            if (property === "fontColor" && pos.activeFontColor == null) {
              return {
                index,
                fontColor: value,
                activeFontColor: pos.activeFontColor ?? pos.fontColor ?? DEFAULT_ACTIVE_FONT_COLOR,
              } as any;
            }
          }
          return { index, [property]: value } as any;
        });
      dispatchStatUpdates(statUpdates, "commit");
    },
    [
      keyPositions,
      statPositions,
      selectedKeyType,
      selectedKeys,
      selectedStats,
      dispatchKeyUpdates,
      dispatchStatUpdates,
    ],
  );

  // 정렬 핸들러
  const handleBatchAlign = useCallback(
    (direction: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => {
      const elements = selectedKeyLikeElements
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const pos = getKeyLikePosition(el.type, el.index!);
          if (!pos) return null;
          return {
            type: el.type,
            index: el.index!,
            x: pos.dx,
            y: pos.dy,
            width: pos.width,
            height: pos.height,
          };
        })
        .filter(
          (d): d is { type: KeyLikeType; index: number; x: number; y: number; width: number; height: number } =>
            d !== null,
        );

      if (elements.length < 2) return;

      const minX = Math.min(...elements.map((k) => k.x));
      const maxX = Math.max(...elements.map((k) => k.x + k.width));
      const minY = Math.min(...elements.map((k) => k.y));
      const maxY = Math.max(...elements.map((k) => k.y + k.height));

      let updates: Array<{ type: KeyLikeType; index: number } & Partial<KeyPosition>> = [];

      switch (direction) {
        case "left":
          updates = elements.map((k) => ({ type: k.type, index: k.index, dx: minX }));
          break;
        case "centerH": {
          const centerX = (minX + maxX) / 2;
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dx: centerX - k.width / 2,
          }));
          break;
        }
        case "right":
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dx: maxX - k.width,
          }));
          break;
        case "top":
          updates = elements.map((k) => ({ type: k.type, index: k.index, dy: minY }));
          break;
        case "centerV": {
          const centerY = (minY + maxY) / 2;
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dy: centerY - k.height / 2,
          }));
          break;
        }
        case "bottom":
          updates = elements.map((k) => ({
            type: k.type,
            index: k.index,
            dy: maxY - k.height,
          }));
          break;
      }

      const keyUpdates = updates
        .filter((u) => u.type === "key")
        .map(({ type: _t, ...rest }) => rest) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      const statUpdates = updates
        .filter((u) => u.type === "stat")
        .map(({ type: _t, ...rest }) => rest) as Array<
        { index: number } & Partial<StatItemPosition>
      >;

      dispatchKeyUpdates(keyUpdates, "commit");
      dispatchStatUpdates(statUpdates, "commit");
    },
    [dispatchKeyUpdates, dispatchStatUpdates, getKeyLikePosition, selectedKeyLikeElements],
  );

  // 분배 핸들러
  const handleBatchDistribute = useCallback(
    (direction: "horizontal" | "vertical") => {
      const elements = selectedKeyLikeElements
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const pos = getKeyLikePosition(el.type, el.index!);
          if (!pos) return null;
          return {
            type: el.type,
            index: el.index!,
            x: pos.dx,
            y: pos.dy,
            width: pos.width,
            height: pos.height,
          };
        })
        .filter(
          (d): d is { type: KeyLikeType; index: number; x: number; y: number; width: number; height: number } =>
            d !== null,
        );

      if (elements.length < 3) return;

      let updates: Array<{ type: KeyLikeType; index: number } & Partial<KeyPosition>> = [];

      if (direction === "horizontal") {
        const sorted = [...elements].sort((a, b) => a.x - b.x);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalSpan = last.x + last.width - first.x;
        const totalWidths = sorted.reduce((sum, k) => sum + k.width, 0);
        const gap = (totalSpan - totalWidths) / (sorted.length - 1);

        let currentX = first.x;
        updates = sorted.map((k) => {
          const newX = currentX;
          currentX += k.width + gap;
          return { type: k.type, index: k.index, dx: newX };
        });
      } else {
        const sorted = [...elements].sort((a, b) => a.y - b.y);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalSpan = last.y + last.height - first.y;
        const totalHeights = sorted.reduce((sum, k) => sum + k.height, 0);
        const gap = (totalSpan - totalHeights) / (sorted.length - 1);

        let currentY = first.y;
        updates = sorted.map((k) => {
          const newY = currentY;
          currentY += k.height + gap;
          return { type: k.type, index: k.index, dy: newY };
        });
      }

      const keyUpdates = updates
        .filter((u) => u.type === "key")
        .map(({ type: _t, ...rest }) => rest) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      const statUpdates = updates
        .filter((u) => u.type === "stat")
        .map(({ type: _t, ...rest }) => rest) as Array<
        { index: number } & Partial<StatItemPosition>
      >;

      dispatchKeyUpdates(keyUpdates, "commit");
      dispatchStatUpdates(statUpdates, "commit");
    },
    [dispatchKeyUpdates, dispatchStatUpdates, getKeyLikePosition, selectedKeyLikeElements],
  );

  // 일괄 크기 변경 핸들러
  const handleBatchResize = useCallback(
    (dimension: "width" | "height", value: number) => {
      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
        { index: number } & Partial<KeyPosition>
      >;
      dispatchKeyUpdates(keyUpdates, "commit");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, [dimension]: value })) as Array<
        { index: number } & Partial<StatItemPosition>
      >;
      dispatchStatUpdates(statUpdates, "commit");
    },
    [dispatchKeyUpdates, dispatchStatUpdates, selectedKeys, selectedStats],
  );

  // 카운터 업데이트 핸들러
  const handleBatchCounterUpdate = useCallback(
    (updates: Partial<KeyCounterSettings>) => {
      const keyUpdates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const pos = keyPositions[selectedKeyType]?.[el.index!];
          if (!pos) return null;
          const currentSettings = normalizeCounterSettings(pos.counter);
          const newSettings = { ...currentSettings, ...updates };
          return { index: el.index!, counter: newSettings };
        })
        .filter(
          (update): update is { index: number; counter: KeyCounterSettings } =>
            update !== null,
        );
      dispatchKeyUpdates(keyUpdates as any, "commit");

      const statUpdates = selectedStats
        .filter((el) => el.index !== undefined)
        .map((el) => {
          const pos = statPositions[selectedKeyType]?.[el.index!];
          if (!pos) return null;
          const currentSettings = normalizeCounterSettings((pos as any).counter);
          const newSettings = { ...currentSettings, ...updates };
          return { index: el.index!, counter: newSettings } as any;
        })
        .filter((update) => update !== null) as Array<
        { index: number; counter: KeyCounterSettings } & Partial<StatItemPosition>
      >;
      dispatchStatUpdates(statUpdates as any, "commit");
    },
    [
      dispatchKeyUpdates,
      dispatchStatUpdates,
      keyPositions,
      statPositions,
      selectedKeyType,
      selectedKeys,
      selectedStats,
    ],
  );

  // 노트 색상 변경 (프리뷰) - 키 요소만
  const handleBatchNoteColorChange = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
        colorValue = { type: "gradient", top: newColor.top, bottom: newColor.bottom };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteColor: colorValue }));

      dispatchKeyUpdates(updates as any, "preview");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  // 노트 색상 변경 완료 (저장) - 키 요소만
  const handleBatchNoteColorChangeComplete = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
        colorValue = { type: "gradient", top: newColor.top, bottom: newColor.bottom };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteColor: colorValue }));

      dispatchKeyUpdates(updates as any, "commit");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  // 글로우 색상 변경 (프리뷰) - 키 요소만
  const handleBatchGlowColorChange = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
        colorValue = { type: "gradient", top: newColor.top, bottom: newColor.bottom };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

      dispatchKeyUpdates(updates as any, "preview");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  // 글로우 색상 변경 완료 (저장) - 키 요소만
  const handleBatchGlowColorChangeComplete = useCallback(
    (newColor: any) => {
      let colorValue: NoteColor;
      if (newColor && typeof newColor === "object" && newColor.type === "gradient") {
        colorValue = { type: "gradient", top: newColor.top, bottom: newColor.bottom };
      } else {
        colorValue = newColor;
      }

      const updates = selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

      dispatchKeyUpdates(updates as any, "commit");
    },
    [dispatchKeyUpdates, selectedKeys],
  );

  return {
    handleBatchStyleChange,
    handleBatchStyleChangeComplete,
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchResize,
    handleBatchCounterUpdate,
    handleBatchNoteColorChange,
    handleBatchNoteColorChangeComplete,
    handleBatchGlowColorChange,
    handleBatchGlowColorChangeComplete,
  };
}

