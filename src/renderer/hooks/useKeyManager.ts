import { useState, useCallback } from "react";
import { useKeyStore } from "@stores/useKeyStore";
import { useStatItemStore } from "@stores/useStatItemStore";
import { useGraphItemStore } from "@stores/useGraphItemStore";
import { useLayerGroupStore } from "@stores/useLayerGroupStore";
import { useHistoryStore } from "@stores/useHistoryStore";
import { usePluginDisplayElementStore } from "@stores/usePluginDisplayElementStore";
import { setUndoRedoInProgress } from "@api/pluginDisplayElements";
import { applyCounterSnapshot } from "@stores/keyCounterSignals";
import type {
  KeyMappings,
  KeyPositions,
  NoteColor,
  KeyCounterSettings,
  ImageFit,
} from "@src/types/keys";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";

type SelectedKey = { key: string; index: number } | null;

type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 두 바운딩 박스가 겹치는지 확인
 */
function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

type KeyUpdatePayload = {
  key: string;
  activeImage?: string;
  inactiveImage?: string;
  activeTransparent?: boolean;
  idleTransparent?: boolean;
  width: number;
  height: number;
  noteColor?: NoteColor;
  noteOpacity?: number;
  noteEffectEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowEnabled?: boolean;
  noteGlowColor?: NoteColor;
  noteAutoYCorrection?: boolean;
  className?: string;
};

type CounterUpdatePayload = KeyCounterSettings;

export function useKeyManager() {
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);
  const setKeyMappings = useKeyStore((state) => state.setKeyMappings);
  const setPositions = useKeyStore((state) => state.setPositions);
  const setLocalUpdateInProgress = useKeyStore(
    (state) => state.setLocalUpdateInProgress,
  );

  const pushState = useHistoryStore((state) => state.pushState);
  const canUndo = useHistoryStore((state) => state.canUndo);
  const canRedo = useHistoryStore((state) => state.canRedo);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);

  const [selectedKey, setSelectedKey] = useState<SelectedKey>(null);

  // 플러그인 요소 스토어
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );
  const setPluginElements = usePluginDisplayElementStore(
    (state) => state.setElements,
  );

  // 히스토리에 현재 상태 저장 (플러그인 요소 포함)
  const saveToHistory = useCallback(() => {
    pushState(
      keyMappings,
      positions,
      statPositions,
      graphPositions,
      pluginElements
    );
  }, [
    keyMappings,
    positions,
    statPositions,
    graphPositions,
    pluginElements,
    pushState,
  ]);

  const handlePositionChange = (index: number, dx: number, dy: number) => {
    const current = positions[selectedKeyType] || [];
    const oldPosition = current[index];

    // 실제로 위치가 변경된 경우에만 히스토리에 저장
    if (oldPosition && (oldPosition.dx !== dx || oldPosition.dy !== dy)) {
      saveToHistory();
    }

    const nextPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              dx,
              dy,
            }
          : pos,
      ),
    };
    setPositions(nextPositions);
    window.api.keys.updatePositions(nextPositions).catch((error) => {
      console.error("Failed to update key positions", error);
    });
  };

  const handleKeyUpdate = (keyData: KeyUpdatePayload) => {
    // 키 설정 모달에서 적용하기 클릭 시 호출됨
    saveToHistory();

    const mapping = keyMappings[selectedKeyType] || [];
    const pos = positions[selectedKeyType] || [];

    if (selectedKey) {
      const updatedMappings: KeyMappings = {
        ...keyMappings,
        [selectedKeyType]: mapping.map((value, idx) =>
          idx === selectedKey.index ? keyData.key : value,
        ),
      };

      const updatedPositions: KeyPositions = {
        ...positions,
        [selectedKeyType]: pos.map((value, idx) =>
          idx === selectedKey.index
            ? {
                ...value,
                activeImage: keyData.activeImage ?? value.activeImage,
                inactiveImage: keyData.inactiveImage ?? value.inactiveImage,
                activeTransparent:
                  keyData.activeTransparent ?? value.activeTransparent ?? false,
                idleTransparent:
                  keyData.idleTransparent ?? value.idleTransparent ?? false,
                width: keyData.width,
                height: keyData.height,
                noteColor: keyData.noteColor ?? value.noteColor ?? "#FFFFFF",
                noteOpacity: keyData.noteOpacity ?? value.noteOpacity ?? 80,
                noteEffectEnabled:
                  keyData.noteEffectEnabled ?? value.noteEffectEnabled ?? true,
                noteGlowEnabled:
                  keyData.noteGlowEnabled ?? value.noteGlowEnabled ?? true,
                noteGlowSize: keyData.noteGlowSize ?? value.noteGlowSize ?? 20,
                noteGlowOpacity:
                  keyData.noteGlowOpacity ?? value.noteGlowOpacity ?? 70,
                noteGlowColor: keyData.noteGlowColor ?? value.noteGlowColor,
                noteAutoYCorrection:
                  keyData.noteAutoYCorrection ??
                  value.noteAutoYCorrection ??
                  true,
                className: keyData.className ?? value.className ?? "",
              }
            : value,
        ),
      };

      setKeyMappings(updatedMappings);
      setPositions(updatedPositions);

      Promise.all([
        window.api.keys.update(updatedMappings),
        window.api.keys.updatePositions(updatedPositions),
      ]).catch((error) => {
        console.error("Failed to persist key update", error);
      });

      setSelectedKey(null);
    }
  };

  const handleAddKey = () => {
    saveToHistory();

    const mapping = keyMappings[selectedKeyType] || [];
    const pos = positions[selectedKeyType] || [];

    const updatedMappings: KeyMappings = {
      ...keyMappings,
      [selectedKeyType]: [...mapping, ""],
    };

    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: [
        ...pos,
        {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          hidden: false,
          activeImage: "",
          inactiveImage: "",
          soundPath: "",
          soundVolume: 100,
          activeTransparent: false,
          idleTransparent: false,
          count: 0,
          noteColor: "#FFFFFF",
          noteOpacity: 80,
          noteEffectEnabled: true,
          noteGlowEnabled: false,
          noteGlowSize: 20,
          noteGlowOpacity: 70,
          noteGlowColor: "#FFFFFF",
          noteAutoYCorrection: true,
          className: "",
          counter: createDefaultCounterSettings(),
        },
      ],
    };

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    Promise.all([
      window.api.keys.update(updatedMappings),
      window.api.keys.updatePositions(updatedPositions),
    ]).catch((error) => {
      console.error("Failed to persist new key", error);
    });
  };

  const handleAddKeyAt = (dx: number, dy: number) => {
    saveToHistory();

    const mapping = keyMappings[selectedKeyType] || [];
    const pos = positions[selectedKeyType] || [];

    const updatedMappings: KeyMappings = {
      ...keyMappings,
      [selectedKeyType]: [...mapping, ""],
    };

    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: [
        ...pos,
        {
          dx,
          dy,
          width: 60,
          height: 60,
          hidden: false,
          activeImage: "",
          inactiveImage: "",
          soundPath: "",
          soundVolume: 100,
          activeTransparent: false,
          idleTransparent: false,
          count: 0,
          noteColor: "#FFFFFF",
          noteOpacity: 80,
          noteEffectEnabled: true,
          noteGlowEnabled: false,
          noteGlowSize: 20,
          noteGlowOpacity: 70,
          noteGlowColor: "#FFFFFF",
          noteAutoYCorrection: true,
          className: "",
          counter: createDefaultCounterSettings(),
        },
      ],
    };

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    Promise.all([
      window.api.keys.update(updatedMappings),
      window.api.keys.updatePositions(updatedPositions),
    ]).catch((error) => {
      console.error("Failed to persist new key at position", error);
    });
  };

  const handleDuplicateKey = (sourceIndex: number, dx: number, dy: number) => {
    saveToHistory();

    const mapping = keyMappings[selectedKeyType] || [];
    const pos = positions[selectedKeyType] || [];
    const sourceKey = mapping[sourceIndex];
    const sourcePosition = pos[sourceIndex];

    if (typeof sourceKey === "undefined" || !sourcePosition) {
      return;
    }

    const clonedNoteColor =
      sourcePosition.noteColor &&
      typeof sourcePosition.noteColor === "object" &&
      sourcePosition.noteColor !== null
        ? { ...sourcePosition.noteColor }
        : sourcePosition.noteColor;

    const clonedCounter = sourcePosition.counter
      ? {
          ...sourcePosition.counter,
          fill: { ...sourcePosition.counter.fill },
          stroke: { ...sourcePosition.counter.stroke },
        }
      : createDefaultCounterSettings();

    const snappedDx = Math.round(dx);
    const snappedDy = Math.round(dy);

    const clonedPosition = {
      ...sourcePosition,
      dx: snappedDx,
      dy: snappedDy,
      counter: clonedCounter,
      noteColor: clonedNoteColor,
      noteGlowEnabled: sourcePosition.noteGlowEnabled ?? true,
      noteGlowSize: sourcePosition.noteGlowSize ?? 20,
      noteGlowOpacity: sourcePosition.noteGlowOpacity ?? 70,
      noteGlowColor: clonedNoteColor,
      noteAutoYCorrection: sourcePosition.noteAutoYCorrection ?? true,
    };

    const updatedMappings: KeyMappings = {
      ...keyMappings,
      [selectedKeyType]: [...mapping, sourceKey],
    };

    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: [...pos, clonedPosition],
    };

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    Promise.all([
      window.api.keys.update(updatedMappings),
      window.api.keys.updatePositions(updatedPositions),
    ]).catch((error) => {
      console.error("Failed to duplicate key", error);
    });
  };

  const handleNoteColorUpdate = (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor | undefined,
  ) => {
    // 노트 색상 설정 모달에서 적용하기 클릭 시 호출됨
    saveToHistory();

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const currentPositions = state.positions;
    const current = currentPositions[mode] || [];
    if (!current[index]) return;

    const updatedPositions: KeyPositions = {
      ...currentPositions,
      [mode]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              noteColor,
              noteOpacity,
              noteGlowEnabled,
              noteGlowSize,
              noteGlowOpacity,
              noteGlowColor: noteGlowColor ?? noteColor,
            }
          : pos,
      ),
    };

    setPositions(updatedPositions);
    window.api.keys.updatePositions(updatedPositions).catch((error) => {
      console.error("Failed to update note color settings", error);
    });
  };

  // 미리보기 전용: 오버레이 실시간 업데이트를 위해 로컬 스토어만 갱신, 영구 저장은 하지 않음
  const handleNoteColorPreview = (
    index: number,
    noteColor: NoteColor,
    noteOpacity: number,
    noteGlowEnabled: boolean,
    noteGlowSize: number,
    noteGlowOpacity: number,
    noteGlowColor: NoteColor | undefined,
    noteAutoYCorrection?: boolean,
    noteEffectEnabled?: boolean,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const currentPositions = state.positions;
    const current = currentPositions[mode] || [];
    if (!current[index]) return;

    const updatedPositions: KeyPositions = {
      ...currentPositions,
      [mode]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              noteColor,
              noteOpacity,
              noteGlowEnabled,
              noteGlowSize,
              noteGlowOpacity,
              noteGlowColor: noteGlowColor ?? noteColor,
              noteAutoYCorrection:
                noteAutoYCorrection ?? pos.noteAutoYCorrection,
              noteEffectEnabled: noteEffectEnabled ?? pos.noteEffectEnabled,
            }
          : pos,
      ),
    };

    setPositions(updatedPositions);
    // 미리보기라도 오버레이에 반영되도록 이벤트 브로드캐스트
    window.api.keys.updatePositions(updatedPositions).catch((error) => {
      console.error("Failed to preview note color settings", error);
    });
  };

  // 키 설정 미리보기 (이미지/회전/크기/스타일)
  const handleKeyPreview = (
    index: number,
    updates: Partial<{
      activeImage: string;
      inactiveImage: string;
      soundPath: string;
      soundVolume: number;
      activeTransparent: boolean;
      idleTransparent: boolean;
      width: number;
      height: number;
      className: string;
      backgroundColor: string;
      activeBackgroundColor: string;
      borderColor: string;
      activeBorderColor: string;
      borderWidth: number;
      borderRadius: number;
      fontSize: number;
      fontColor: string;
      activeFontColor: string;
      idleImageFit: ImageFit;
      activeImageFit: ImageFit;
      imageFit: ImageFit;
      useInlineStyles: boolean;
      displayText: string;
    }>,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const currentPositions = state.positions;
    const current = currentPositions[mode] || [];
    if (!current[index]) return;

    const updatedPositions: KeyPositions = {
      ...currentPositions,
      [mode]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              activeImage:
                updates.activeImage !== undefined
                  ? updates.activeImage
                  : pos.activeImage,
              inactiveImage:
                updates.inactiveImage !== undefined
                  ? updates.inactiveImage
                  : pos.inactiveImage,
              soundPath:
                updates.soundPath !== undefined
                  ? updates.soundPath
                  : pos.soundPath,
              soundVolume:
                updates.soundVolume !== undefined
                  ? updates.soundVolume
                  : pos.soundVolume,
              activeTransparent:
                updates.activeTransparent !== undefined
                  ? updates.activeTransparent
                  : pos.activeTransparent ?? false,
              idleTransparent:
                updates.idleTransparent !== undefined
                  ? updates.idleTransparent
                  : pos.idleTransparent ?? false,
              width:
                typeof updates.width === "number" &&
                !Number.isNaN(updates.width)
                  ? updates.width
                  : pos.width,
              height:
                typeof updates.height === "number" &&
                !Number.isNaN(updates.height)
                  ? updates.height
                  : pos.height,
              className:
                updates.className !== undefined
                  ? updates.className
                  : pos.className ?? "",
              // 새 스타일 속성들
              backgroundColor:
                updates.backgroundColor !== undefined
                  ? updates.backgroundColor
                  : pos.backgroundColor,
              activeBackgroundColor:
                updates.activeBackgroundColor !== undefined
                  ? updates.activeBackgroundColor
                  : pos.activeBackgroundColor,
              borderColor:
                updates.borderColor !== undefined
                  ? updates.borderColor
                  : pos.borderColor,
              activeBorderColor:
                updates.activeBorderColor !== undefined
                  ? updates.activeBorderColor
                  : pos.activeBorderColor,
              borderWidth:
                updates.borderWidth !== undefined
                  ? updates.borderWidth
                  : pos.borderWidth,
              borderRadius:
                updates.borderRadius !== undefined
                  ? updates.borderRadius
                  : pos.borderRadius,
              fontSize:
                updates.fontSize !== undefined
                  ? updates.fontSize
                  : pos.fontSize,
              fontColor:
                updates.fontColor !== undefined
                  ? updates.fontColor
                  : pos.fontColor,
              activeFontColor:
                updates.activeFontColor !== undefined
                  ? updates.activeFontColor
                  : pos.activeFontColor,
              idleImageFit:
                updates.idleImageFit !== undefined
                  ? updates.idleImageFit
                  : pos.idleImageFit,
              activeImageFit:
                updates.activeImageFit !== undefined
                  ? updates.activeImageFit
                  : pos.activeImageFit,
              imageFit:
                updates.imageFit !== undefined
                  ? updates.imageFit
                  : pos.imageFit,
              useInlineStyles:
                updates.useInlineStyles !== undefined
                  ? updates.useInlineStyles
                  : pos.useInlineStyles,
              displayText:
                updates.displayText !== undefined
                  ? updates.displayText
                  : pos.displayText,
            }
          : pos,
      ),
    };

    setPositions(updatedPositions);
    window.api.keys.updatePositions(updatedPositions).catch((error) => {
      console.error("Failed to preview key settings", error);
    });
  };

  // 다중 선택 시 여러 키를 한 번에 프리뷰 (배치 프리뷰)
  const handleKeyBatchPreview = (
    updates: Array<{
      index: number;
      activeImage?: string;
      inactiveImage?: string;
      soundPath?: string;
      soundVolume?: number;
      activeTransparent?: boolean;
      idleTransparent?: boolean;
      width?: number;
      height?: number;
      className?: string;
      backgroundColor?: string;
      activeBackgroundColor?: string;
      borderColor?: string;
      activeBorderColor?: string;
      borderWidth?: number;
      borderRadius?: number;
      fontSize?: number;
      fontColor?: string;
      activeFontColor?: string;
      idleImageFit?: ImageFit;
      activeImageFit?: ImageFit;
      imageFit?: ImageFit;
      useInlineStyles?: boolean;
      displayText?: string;
      noteColor?: NoteColor;
      noteGlowColor?: NoteColor;
    }>,
  ) => {
    if (updates.length === 0) return;

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const currentPositions = state.positions;
    const current = currentPositions[mode] || [];

    // 업데이트할 인덱스들을 Map으로 변환
    const updateMap = new Map<number, (typeof updates)[number]>();
    for (const update of updates) {
      if (current[update.index]) {
        updateMap.set(update.index, update);
      }
    }

    if (updateMap.size === 0) return;

    const updatedPositions: KeyPositions = {
      ...currentPositions,
      [mode]: current.map((pos, i) => {
        const update = updateMap.get(i);
        if (!update) return pos;

        return {
          ...pos,
          activeImage:
            update.activeImage !== undefined
              ? update.activeImage
              : pos.activeImage,
          inactiveImage:
            update.inactiveImage !== undefined
              ? update.inactiveImage
              : pos.inactiveImage,
          soundPath:
            update.soundPath !== undefined
              ? update.soundPath
              : pos.soundPath,
          soundVolume:
            update.soundVolume !== undefined
              ? update.soundVolume
              : pos.soundVolume,
          activeTransparent:
            update.activeTransparent !== undefined
              ? update.activeTransparent
              : pos.activeTransparent ?? false,
          idleTransparent:
            update.idleTransparent !== undefined
              ? update.idleTransparent
              : pos.idleTransparent ?? false,
          width:
            typeof update.width === "number" && !Number.isNaN(update.width)
              ? update.width
              : pos.width,
          height:
            typeof update.height === "number" && !Number.isNaN(update.height)
              ? update.height
              : pos.height,
          className:
            update.className !== undefined
              ? update.className
              : pos.className ?? "",
          backgroundColor:
            update.backgroundColor !== undefined
              ? update.backgroundColor
              : pos.backgroundColor,
          activeBackgroundColor:
            update.activeBackgroundColor !== undefined
              ? update.activeBackgroundColor
              : pos.activeBackgroundColor,
          borderColor:
            update.borderColor !== undefined
              ? update.borderColor
              : pos.borderColor,
          activeBorderColor:
            update.activeBorderColor !== undefined
              ? update.activeBorderColor
              : pos.activeBorderColor,
          borderWidth:
            update.borderWidth !== undefined
              ? update.borderWidth
              : pos.borderWidth,
          borderRadius:
            update.borderRadius !== undefined
              ? update.borderRadius
              : pos.borderRadius,
          fontSize:
            update.fontSize !== undefined ? update.fontSize : pos.fontSize,
          fontColor:
            update.fontColor !== undefined ? update.fontColor : pos.fontColor,
          activeFontColor:
            update.activeFontColor !== undefined
              ? update.activeFontColor
              : pos.activeFontColor,
          idleImageFit:
            update.idleImageFit !== undefined
              ? update.idleImageFit
              : pos.idleImageFit,
          activeImageFit:
            update.activeImageFit !== undefined
              ? update.activeImageFit
              : pos.activeImageFit,
          imageFit:
            update.imageFit !== undefined ? update.imageFit : pos.imageFit,
          useInlineStyles:
            update.useInlineStyles !== undefined
              ? update.useInlineStyles
              : pos.useInlineStyles,
          displayText:
            update.displayText !== undefined
              ? update.displayText
              : pos.displayText,
          noteColor:
            update.noteColor !== undefined ? update.noteColor : pos.noteColor,
          noteGlowColor:
            update.noteGlowColor !== undefined
              ? update.noteGlowColor
              : pos.noteGlowColor,
        };
      }),
    };

    setPositions(updatedPositions);
    window.api.keys.updatePositions(updatedPositions).catch((error) => {
      console.error("Failed to batch preview key settings", error);
    });
  };

  const handleCounterSettingsUpdate = (
    index: number,
    payload: CounterUpdatePayload,
  ) => {
    // 카운터 설정 모달에서 적용하기 클릭 시 호출됨
    saveToHistory();

    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const currentPositions = state.positions;
    const current = currentPositions[mode] || [];
    if (!current[index]) return;

    const normalized = normalizeCounterSettings(payload);
    const updatedPositions: KeyPositions = {
      ...currentPositions,
      [mode]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              counter: normalized,
            }
          : pos,
      ),
    };

    setPositions(updatedPositions);
    window.api.keys.updatePositions(updatedPositions).catch((error) => {
      console.error("Failed to update counter settings", error);
    });
  };

  // 미리보기 전용: 오버레이 실시간 업데이트를 위해 로컬 스토어만 갱신, 영구 저장은 하지 않음
  const handleCounterSettingsPreview = (
    index: number,
    payload: CounterUpdatePayload,
  ) => {
    const state = useKeyStore.getState();
    const mode = state.selectedKeyType || selectedKeyType;
    const currentPositions = state.positions;
    const current = currentPositions[mode] || [];
    if (!current[index]) return;

    const normalized = normalizeCounterSettings(payload);
    const updatedPositions: KeyPositions = {
      ...currentPositions,
      [mode]: current.map((pos, i) =>
        i === index
          ? {
              ...pos,
              counter: normalized,
            }
          : pos,
      ),
    };

    setPositions(updatedPositions);
    // 미리보기라도 오버레이에 반영되도록 이벤트 브로드캐스트
    window.api.keys.updatePositions(updatedPositions).catch((error) => {
      console.error("Failed to preview counter settings", error);
    });
  };

  const handleDeleteKey = (indexToDelete: number) => {
    saveToHistory();

    const mapping = keyMappings[selectedKeyType] || [];
    const pos = positions[selectedKeyType] || [];

    const updatedMappings: KeyMappings = {
      ...keyMappings,
      [selectedKeyType]: mapping.filter((_, index) => index !== indexToDelete),
    };

    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: pos.filter((_, index) => index !== indexToDelete),
    };

    setKeyMappings(updatedMappings);
    setPositions(updatedPositions);

    Promise.all([
      window.api.keys.update(updatedMappings),
      window.api.keys.updatePositions(updatedPositions),
    ]).catch((error) => {
      console.error("Failed to delete key", error);
    });

    setSelectedKey(null);
  };

  const handleMoveToFront = async (index: number) => {
    saveToHistory();

    const pos = positions[selectedKeyType] || [];
    const pluginElements = usePluginDisplayElementStore.getState().elements;

    // 키와 플러그인 요소 중 가장 높은 zIndex 찾기
    const keyZIndexes = pos.map((p, i) => p.zIndex ?? i);
    const pluginZIndexes = pluginElements.map((el) => el.zIndex ?? 0);
    const maxZIndex = Math.max(0, ...keyZIndexes, ...pluginZIndexes);

    // 대상 키의 zIndex를 가장 높은 값 + 1로 설정
    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: pos.map((p, i) =>
        i === index ? { ...p, zIndex: maxZIndex + 1 } : p,
      ),
    };

    // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
    setLocalUpdateInProgress(true);
    setPositions(updatedPositions);

    try {
      await window.api.keys.updatePositions(updatedPositions);
      // 오버레이에 직접 동기화
      window.api.bridge.sendTo("overlay", "positions:sync", {
        positions: updatedPositions,
      });
    } catch (error) {
      console.error("Failed to move key to front", error);
    } finally {
      setLocalUpdateInProgress(false);
    }
  };

  const handleMoveToBack = async (index: number) => {
    saveToHistory();

    const pos = positions[selectedKeyType] || [];
    const pluginElements = usePluginDisplayElementStore.getState().elements;

    // 키와 플러그인 요소 중 가장 낮은 zIndex 찾기 (음수 가능)
    const keyZIndexes = pos.map((p, i) => p.zIndex ?? i);
    const pluginZIndexes = pluginElements.map((el) => el.zIndex ?? 0);
    const minZIndex = Math.min(0, ...keyZIndexes, ...pluginZIndexes);

    // 대상 키의 zIndex를 가장 낮은 값 - 1로 설정
    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: pos.map((p, i) =>
        i === index ? { ...p, zIndex: minZIndex - 1 } : p,
      ),
    };

    // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
    setLocalUpdateInProgress(true);
    setPositions(updatedPositions);

    try {
      await window.api.keys.updatePositions(updatedPositions);
      // 오버레이에 직접 동기화
      window.api.bridge.sendTo("overlay", "positions:sync", {
        positions: updatedPositions,
      });
    } catch (error) {
      console.error("Failed to move key to back", error);
    } finally {
      setLocalUpdateInProgress(false);
    }
  };

  const handleMoveForward = async (index: number) => {
    saveToHistory();

    const pos = positions[selectedKeyType] || [];
    const targetKey = pos[index];
    if (!targetKey) return;

    const currentZIndex = targetKey.zIndex ?? index;
    const pluginElements = usePluginDisplayElementStore.getState().elements;

    // 대상 키의 바운딩 박스
    const targetBox = {
      x: targetKey.dx,
      y: targetKey.dy,
      width: targetKey.width,
      height: targetKey.height,
    };

    // 겹치는 요소들의 zIndex 수집 (현재 요소보다 위에 있는 것만)
    const overlappingZIndexes: number[] = [];

    // 다른 키들 중 겹치는 것
    pos.forEach((p, i) => {
      if (i === index) return;
      const keyZ = p.zIndex ?? i;
      if (keyZ <= currentZIndex) return; // 현재보다 아래면 무시

      const keyBox = { x: p.dx, y: p.dy, width: p.width, height: p.height };
      if (boxesOverlap(targetBox, keyBox)) {
        overlappingZIndexes.push(keyZ);
      }
    });

    // 플러그인 요소들 중 겹치는 것
    pluginElements.forEach((el) => {
      const elZ = el.zIndex ?? 0;
      if (elZ <= currentZIndex) return; // 현재보다 아래면 무시

      const elBox = {
        x: el.position.x,
        y: el.position.y,
        width: el.measuredSize?.width ?? el.estimatedSize?.width ?? 100,
        height: el.measuredSize?.height ?? el.estimatedSize?.height ?? 100,
      };
      if (boxesOverlap(targetBox, elBox)) {
        overlappingZIndexes.push(elZ);
      }
    });

    // 겹치는 요소가 없으면 단순히 +1
    // 겹치는 요소가 있으면 바로 위 요소의 zIndex보다 1 크게 설정
    let newZIndex: number;
    if (overlappingZIndexes.length === 0) {
      newZIndex = currentZIndex + 1;
    } else {
      const minOverlappingZ = Math.min(...overlappingZIndexes);
      newZIndex = minOverlappingZ + 1;
    }

    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: pos.map((p, i) =>
        i === index ? { ...p, zIndex: newZIndex } : p,
      ),
    };

    // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
    setLocalUpdateInProgress(true);
    setPositions(updatedPositions);

    try {
      await window.api.keys.updatePositions(updatedPositions);
      // 오버레이에 직접 동기화
      window.api.bridge.sendTo("overlay", "positions:sync", {
        positions: updatedPositions,
      });
    } catch (error) {
      console.error("Failed to move key forward", error);
    } finally {
      setLocalUpdateInProgress(false);
    }
  };

  const handleMoveBackward = async (index: number) => {
    saveToHistory();

    const pos = positions[selectedKeyType] || [];
    const targetKey = pos[index];
    if (!targetKey) return;

    const currentZIndex = targetKey.zIndex ?? index;
    const pluginElements = usePluginDisplayElementStore.getState().elements;

    // 대상 키의 바운딩 박스
    const targetBox = {
      x: targetKey.dx,
      y: targetKey.dy,
      width: targetKey.width,
      height: targetKey.height,
    };

    // 겹치는 요소들의 zIndex 수집 (현재 요소보다 아래에 있는 것만)
    const overlappingZIndexes: number[] = [];

    // 다른 키들 중 겹치는 것
    pos.forEach((p, i) => {
      if (i === index) return;
      const keyZ = p.zIndex ?? i;
      if (keyZ >= currentZIndex) return; // 현재보다 위면 무시

      const keyBox = { x: p.dx, y: p.dy, width: p.width, height: p.height };
      if (boxesOverlap(targetBox, keyBox)) {
        overlappingZIndexes.push(keyZ);
      }
    });

    // 플러그인 요소들 중 겹치는 것
    pluginElements.forEach((el) => {
      const elZ = el.zIndex ?? 0;
      if (elZ >= currentZIndex) return; // 현재보다 위면 무시

      const elBox = {
        x: el.position.x,
        y: el.position.y,
        width: el.measuredSize?.width ?? el.estimatedSize?.width ?? 100,
        height: el.measuredSize?.height ?? el.estimatedSize?.height ?? 100,
      };
      if (boxesOverlap(targetBox, elBox)) {
        overlappingZIndexes.push(elZ);
      }
    });

    // 겹치는 요소가 없으면 단순히 -1
    // 겹치는 요소가 있으면 바로 아래 요소의 zIndex보다 1 작게 설정
    let newZIndex: number;
    if (overlappingZIndexes.length === 0) {
      newZIndex = currentZIndex - 1;
    } else {
      const maxOverlappingZ = Math.max(...overlappingZIndexes);
      newZIndex = maxOverlappingZ - 1;
    }

    const updatedPositions: KeyPositions = {
      ...positions,
      [selectedKeyType]: pos.map((p, i) =>
        i === index ? { ...p, zIndex: newZIndex } : p,
      ),
    };

    // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
    setLocalUpdateInProgress(true);
    setPositions(updatedPositions);

    try {
      await window.api.keys.updatePositions(updatedPositions);
      // 오버레이에 직접 동기화
      window.api.bridge.sendTo("overlay", "positions:sync", {
        positions: updatedPositions,
      });
    } catch (error) {
      console.error("Failed to move key backward", error);
    } finally {
      setLocalUpdateInProgress(false);
    }
  };

  const handleResetCurrentMode = async () => {
    try {
      await window.api.keys.resetMode(selectedKeyType);
      setSelectedKey(null);
    } catch (error) {
      console.error("Failed to reset current mode", error);
    }
  };

  const handleUndo = useCallback(async () => {
    setUndoRedoInProgress(true);
    try {
      // 현재 상태를 가져와서 undo 호출 시 전달
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
      const previousState = undo(
        keyMappings,
        positions,
        statPositions,
        graphPositions,
        currentPluginElements,
        currentLayerGroups,
      );

      if (previousState) {
        setKeyMappings(previousState.keyMappings);
        setPositions(previousState.positions);
        useStatItemStore.getState().setPositions(previousState.statPositions);
        useGraphItemStore.getState().setPositions(previousState.graphPositions);
        if (previousState.layerGroups !== undefined) {
          useLayerGroupStore.getState().setLayerGroups(previousState.layerGroups);
        }

        // UI는 즉시 반영 (백엔드 이벤트로 다시 한번 동기화됨)
        if (previousState.keyCounters) {
          applyCounterSnapshot(previousState.keyCounters);
        }

        // 플러그인 요소 복원 (pluginElements가 존재하는 경우에만)
        // undefined인 경우는 해당 히스토리 항목이 플러그인 요소 변경과 무관하므로 현재 상태 유지
        if (previousState.pluginElements !== undefined) {
          // 현재 요소들의 핸들러 정보를 유지하면서 위치/설정만 복원
          const currentElements = currentPluginElements;

          // 요소 복원 함수 맵 가져오기
          const elementRestorers = (window as any).__dmn_element_restorers as
            | Map<string, (el: any) => any>
            | undefined;

          const restoredElements = previousState.pluginElements.map(
            (savedEl) => {
              // 같은 fullId를 가진 현재 요소 찾기
              const currentEl = currentElements.find(
                (el) => el.fullId === savedEl.fullId,
              );
              if (currentEl) {
                // 현재 요소의 핸들러 정보 유지, 저장된 위치/설정으로 복원
                return {
                  ...currentEl,
                  position: savedEl.position,
                  settings: savedEl.settings,
                  state: savedEl.state,
                  measuredSize: savedEl.measuredSize,
                  resizeAnchor: savedEl.resizeAnchor,
                  zIndex: savedEl.zIndex,
                  hidden: (savedEl as any).hidden,
                };
              }

              // 현재 없는 요소 (삭제된 요소 복구)
              // definitionId가 있으면 해당 정의의 복원 함수 사용
              if (
                savedEl.definitionId &&
                elementRestorers?.has(savedEl.definitionId)
              ) {
                const restorer = elementRestorers.get(savedEl.definitionId)!;
                return restorer(savedEl);
              }

              // 복원 함수가 없으면 그대로 반환 (핸들러 없이)
              return savedEl;
            },
          );

          // 현재 있지만 저장된 상태에 없는 요소 제거 (추가된 요소 취소)
          const savedFullIds = new Set(
            previousState.pluginElements.map((el) => el.fullId),
          );
          const finalElements = restoredElements.filter(
            (el) =>
              savedFullIds.has(el.fullId) ||
              currentElements.some((cur) => cur.fullId === el.fullId),
          );

          setPluginElements(finalElements as any);

          // 오버레이로 동기화
          if (window.api?.bridge) {
            window.api.bridge.sendTo("overlay", "plugin:displayElements:sync", {
              elements: finalElements,
            });
          }
        }

        // 백엔드에도 반영
        // 중요: keys.update()가 counters를 keys 기준으로 sync 하므로,
        // counters 복원은 keys/positions 복원 이후에 실행해야 값이 유지됨
        try {
          // counters sync는 keys.update() 결과에 의존하므로 먼저 실행
          await window.api.keys.update(previousState.keyMappings);

          // positions는 실패해도 undo의 핵심(키/카운터 복구)을 막지 않도록 분리
          window.api.keys
            .updatePositions(previousState.positions)
            .catch((error) => {
              console.error("Failed to apply undo positions", error);
            });

          window.api.statItems
            .updatePositions(previousState.statPositions as any)
            .catch((error) => {
              console.error("Failed to apply undo stat positions", error);
            });
          window.api.graphItems
            .updatePositions(previousState.graphPositions as any)
            .catch((error) => {
              console.error("Failed to apply undo graph positions", error);
            });
          if (previousState.layerGroups !== undefined) {
            window.api.layerGroups.update(previousState.layerGroups).catch((error) => {
              console.error("Failed to apply undo layer groups", error);
            });
          }

          if (previousState.keyCounters) {
            await window.api.keys.setCounters(previousState.keyCounters);
          }

          try {
            window.api.bridge.sendTo("overlay", "statPositions:sync", {
              positions: previousState.statPositions,
            });
          } catch {
            // ignore
          }
          try {
            window.api.bridge.sendTo("overlay", "graphPositions:sync", {
              positions: previousState.graphPositions,
            });
          } catch {
            // ignore
          }
        } catch (error) {
          console.error("Failed to apply undo", error);
        }
      }
    } finally {
      setUndoRedoInProgress(false);
    }
  }, [
    undo,
    keyMappings,
    positions,
    statPositions,
    graphPositions,
    setKeyMappings,
    setPositions,
    setPluginElements,
  ]);

  const handleRedo = useCallback(async () => {
    setUndoRedoInProgress(true);
    try {
      // 현재 상태를 가져와서 redo 호출 시 전달
      const currentPluginElements =
        usePluginDisplayElementStore.getState().elements;
      const currentLayerGroups = useLayerGroupStore.getState().layerGroups;
      const nextState = redo(
        keyMappings,
        positions,
        statPositions,
        graphPositions,
        currentPluginElements,
        currentLayerGroups,
      );

      if (nextState) {
        setKeyMappings(nextState.keyMappings);
        setPositions(nextState.positions);
        useStatItemStore.getState().setPositions(nextState.statPositions);
        useGraphItemStore.getState().setPositions(nextState.graphPositions);
        if (nextState.layerGroups !== undefined) {
          useLayerGroupStore.getState().setLayerGroups(nextState.layerGroups);
        }

        // UI는 즉시 반영 (백엔드 이벤트로 다시 한번 동기화됨)
        if (nextState.keyCounters) {
          applyCounterSnapshot(nextState.keyCounters);
        }

        // 플러그인 요소 복원 (pluginElements가 존재하는 경우에만)
        // undefined인 경우는 해당 히스토리 항목이 플러그인 요소 변경과 무관하므로 현재 상태 유지
        if (nextState.pluginElements !== undefined) {
          // 현재 요소들의 핸들러 정보를 유지하면서 위치/설정만 복원
          const currentElements = currentPluginElements;

          // 요소 복원 함수 맵 가져오기
          const elementRestorers = (window as any).__dmn_element_restorers as
            | Map<string, (el: any) => any>
            | undefined;

          const restoredElements = nextState.pluginElements.map((savedEl) => {
            // 같은 fullId를 가진 현재 요소 찾기
            const currentEl = currentElements.find(
              (el) => el.fullId === savedEl.fullId,
            );
            if (currentEl) {
              // 현재 요소의 핸들러 정보 유지, 저장된 위치/설정으로 복원
              return {
                ...currentEl,
                position: savedEl.position,
                settings: savedEl.settings,
                state: savedEl.state,
                measuredSize: savedEl.measuredSize,
                resizeAnchor: savedEl.resizeAnchor,
                zIndex: savedEl.zIndex,
                hidden: (savedEl as any).hidden,
              };
            }

            // 현재 없는 요소 (삭제된 요소 복구 - redo에서는 드물지만 처리)
            // definitionId가 있으면 해당 정의의 복원 함수 사용
            if (
              savedEl.definitionId &&
              elementRestorers?.has(savedEl.definitionId)
            ) {
              const restorer = elementRestorers.get(savedEl.definitionId)!;
              return restorer(savedEl);
            }

            // 복원 함수가 없으면 그대로 반환
            return savedEl;
          });

          // 저장된 상태에 있는 요소만 유지
          const savedFullIds = new Set(
            nextState.pluginElements.map((el) => el.fullId),
          );
          const finalElements = restoredElements.filter((el) =>
            savedFullIds.has(el.fullId),
          );

          setPluginElements(finalElements as any);

          // 오버레이로 동기화
          if (window.api?.bridge) {
            window.api.bridge.sendTo("overlay", "plugin:displayElements:sync", {
              elements: finalElements,
            });
          }
        }

        // 백엔드에도 반영 (keys/positions 복원 후 counters 복원)
        try {
          await window.api.keys.update(nextState.keyMappings);
          window.api.keys
            .updatePositions(nextState.positions)
            .catch((error) => {
              console.error("Failed to apply redo positions", error);
            });

          window.api.statItems
            .updatePositions(nextState.statPositions as any)
            .catch((error) => {
              console.error("Failed to apply redo stat positions", error);
            });
          window.api.graphItems
            .updatePositions(nextState.graphPositions as any)
            .catch((error) => {
              console.error("Failed to apply redo graph positions", error);
            });
          if (nextState.layerGroups !== undefined) {
            window.api.layerGroups.update(nextState.layerGroups).catch((error) => {
              console.error("Failed to apply redo layer groups", error);
            });
          }

          if (nextState.keyCounters) {
            await window.api.keys.setCounters(nextState.keyCounters);
          }

          try {
            window.api.bridge.sendTo("overlay", "statPositions:sync", {
              positions: nextState.statPositions,
            });
          } catch {
            // ignore
          }
          try {
            window.api.bridge.sendTo("overlay", "graphPositions:sync", {
              positions: nextState.graphPositions,
            });
          } catch {
            // ignore
          }
        } catch (error) {
          console.error("Failed to apply redo", error);
        }
      }
    } finally {
      setUndoRedoInProgress(false);
    }
  }, [
    redo,
    keyMappings,
    positions,
    statPositions,
    graphPositions,
    setKeyMappings,
    setPositions,
    setPluginElements,
  ]);

  // 속성 패널에서 키 매핑 변경 (인덱스로 키 코드 업데이트)
  const handleKeyMappingChange = useCallback(
    (index: number, newKey: string) => {
      saveToHistory();

      const mapping = keyMappings[selectedKeyType] || [];
      const updatedMappings: KeyMappings = {
        ...keyMappings,
        [selectedKeyType]: mapping.map((key, i) =>
          i === index ? newKey : key,
        ),
      };

      setKeyMappings(updatedMappings);
      window.api.keys.update(updatedMappings).catch((error) => {
        console.error("Failed to update key mapping", error);
      });
    },
    [selectedKeyType, keyMappings, saveToHistory, setKeyMappings],
  );

  // 속성 패널에서 인덱스로 키 속성 업데이트 (히스토리 포함)
  const handleKeyStyleUpdate = useCallback(
    (index: number, updates: Partial<KeyPositions[string][number]>) => {
      const state = useKeyStore.getState();
      const mode = state.selectedKeyType || selectedKeyType;
      const currentPositions = state.positions;
      const current = currentPositions[mode] || [];
      if (!current[index]) return;

      // 히스토리에 현재 상태 저장
      saveToHistory();

      const updatedPositions: KeyPositions = {
        ...currentPositions,
        [mode]: current.map((pos, i) =>
          i === index ? { ...pos, ...updates } : pos,
        ),
      };

      // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
      setLocalUpdateInProgress(true);
      setPositions(updatedPositions);
      window.api.keys
        .updatePositions(updatedPositions)
        .catch((error) => {
          console.error("Failed to update key style", error);
        })
        .finally(() => {
          setLocalUpdateInProgress(false);
        });
    },
    [selectedKeyType, saveToHistory, setPositions, setLocalUpdateInProgress],
  );

  // 다중 선택 시 여러 키를 한 번에 업데이트 (배치 업데이트)
  const handleKeyBatchStyleUpdate = useCallback(
    (
      updates: Array<{ index: number } & Partial<KeyPositions[string][number]>>,
      options?: { skipHistory?: boolean },
    ) => {
      if (updates.length === 0) return;

      const state = useKeyStore.getState();
      const mode = state.selectedKeyType || selectedKeyType;
      const currentPositions = state.positions;
      const current = currentPositions[mode] || [];

      // 업데이트할 인덱스들을 Map으로 변환하여 O(1) 조회
      const updateMap = new Map<
        number,
        Partial<KeyPositions[string][number]>
      >();
      for (const { index, ...rest } of updates) {
        if (current[index]) {
          updateMap.set(index, rest);
        }
      }

      if (updateMap.size === 0) return;

      // 히스토리에 현재 상태 저장 (한 번만)
      if (!options?.skipHistory) {
        saveToHistory();
      }

      const updatedPositions: KeyPositions = {
        ...currentPositions,
        [mode]: current.map((pos, i) => {
          const update = updateMap.get(i);
          return update ? { ...pos, ...update } : pos;
        }),
      };

      // 로컬 업데이트 플래그 설정 (백엔드 이벤트 무시)
      setLocalUpdateInProgress(true);
      setPositions(updatedPositions);
      window.api.keys
        .updatePositions(updatedPositions)
        .catch((error) => {
          console.error("Failed to batch update key styles", error);
        })
        .finally(() => {
          setLocalUpdateInProgress(false);
        });
    },
    [selectedKeyType, saveToHistory, setPositions, setLocalUpdateInProgress],
  );

  return {
    selectedKey,
    setSelectedKey,
    keyMappings,
    positions,
    handlePositionChange,
    handleKeyUpdate,
    handleKeyPreview,
    handleKeyBatchPreview,
    handleKeyStyleUpdate,
    handleKeyBatchStyleUpdate,
    handleKeyMappingChange,
    handleNoteColorUpdate,
    handleNoteColorPreview,
    handleCounterSettingsUpdate,
    handleCounterSettingsPreview,
    handleAddKey,
    handleAddKeyAt,
    handleDuplicateKey,
    handleDeleteKey,
    handleMoveToFront,
    handleMoveToBack,
    handleMoveForward,
    handleMoveBackward,
    handleResetCurrentMode,
    handleUndo,
    handleRedo,
    canUndo: canUndo(),
    canRedo: canRedo(),
  };
}
