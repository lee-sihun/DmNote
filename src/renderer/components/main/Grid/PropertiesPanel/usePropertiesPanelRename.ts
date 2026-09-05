import { useEffect, useRef, useState } from 'react';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import {
  patchElementLayerNameById,
  renameLayerGroupById,
} from '@src/renderer/editor/runtime/elementOps';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { getStatTypeLabel } from './propertyPanelAdapters';
import type { usePropertiesPanelSelection } from './usePropertiesPanelSelection';

type PropertiesPanelSelection = ReturnType<typeof usePropertiesPanelSelection>;

interface UsePropertiesPanelRenameOptions {
  selectedElements: PropertiesPanelSelection['selectedElements'];
  selectedKeyType: string;
  selectedGroupInfo: PropertiesPanelSelection['selectedGroupInfo'];
  singleKeyPosition: PropertiesPanelSelection['singleKeyPosition'];
  singleStatPosition: PropertiesPanelSelection['singleStatPosition'];
  singleGraphPosition: PropertiesPanelSelection['singleGraphPosition'];
  singleKnobPosition: PropertiesPanelSelection['singleKnobPosition'];
  singleSpritePosition: PropertiesPanelSelection['singleSpritePosition'];
  singleKeyInfo: PropertiesPanelSelection['singleKeyInfo'];
  singleKeyCode: PropertiesPanelSelection['singleKeyCode'];
  setPanelMode: (mode: 'layer' | 'property') => void;
}

export const usePropertiesPanelRename = ({
  selectedElements,
  selectedKeyType,
  selectedGroupInfo,
  singleKeyPosition,
  singleStatPosition,
  singleGraphPosition,
  singleKnobPosition,
  singleSpritePosition,
  singleKeyInfo,
  singleKeyCode,
  setPanelMode,
}: UsePropertiesPanelRenameOptions) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const renameRequestSignal = usePropertiesPanelStore(
    (state) => state.renameRequestSignal,
  );

  const getCurrentLayerName = (): string => {
    if (selectedGroupInfo) return selectedGroupInfo.name || '';
    if (singleKeyPosition) return singleKeyPosition.layerName || '';
    if (singleStatPosition) return singleStatPosition.layerName || '';
    if (singleGraphPosition) return singleGraphPosition.layerName || '';
    if (singleKnobPosition) return singleKnobPosition.layerName || '';
    if (singleSpritePosition) return singleSpritePosition.layerName || '';
    return '';
  };

  const getCurrentDefaultTitle = (): string => {
    if (selectedGroupInfo) return selectedGroupInfo.name;
    if (singleKeyPosition) {
      return singleKeyInfo?.displayName || singleKeyCode || 'Key';
    }
    if (singleStatPosition) {
      return getStatTypeLabel(singleStatPosition.statType ?? null);
    }
    if (singleGraphPosition) {
      return `${getStatTypeLabel(singleGraphPosition.statType ?? null)} Graph`;
    }
    if (singleKnobPosition) return 'Knob';
    if (singleSpritePosition) return 'Sprite';
    return '';
  };

  const handleGroupRenameCommit = async (groupId: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return;

    const currentGroups = useLayerGroupStore.getState().layerGroups;
    const currentModeGroups = currentGroups[selectedKeyType] || [];
    const currentGroup = currentModeGroups.find(
      (group) => group.id === groupId,
    );
    if (!currentGroup || currentGroup.name === trimmed) return;

    try {
      await renameLayerGroupById(selectedKeyType, groupId, trimmed);
    } catch (error) {
      console.error('Failed to rename group', error);
    }
  };

  const handleRenameStartImpl = useRef<() => void>(() => {});
  // eslint-disable-next-line react-hooks/refs -- 안정 래퍼의 최신 이름 변경 콜백 유지
  handleRenameStartImpl.current = () => {
    // Escape로 언마운트된 입력은 blur가 오지 않아 취소 플래그가 남는다 - 다음 입력의 커밋이 삼켜지지 않게 초기화
    renameCancelledRef.current = false;
    const current = getCurrentLayerName();
    setRenameValue(current || getCurrentDefaultTitle());
    setIsRenaming(true);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  };
  const handleRenameStart = () => {
    handleRenameStartImpl.current();
  };

  const handleRenameCommit = async (value: string) => {
    setIsRenaming(false);

    if (selectedGroupInfo) {
      await handleGroupRenameCommit(selectedGroupInfo.id, value);
      return;
    }

    const trimmed = value.trim();
    const defaultTitle = getCurrentDefaultTitle();
    const newLayerName =
      trimmed === defaultTitle || trimmed === '' ? null : trimmed;

    const selectedElement =
      selectedElements.length === 1 ? selectedElements[0] : null;
    const stableTarget =
      selectedElement && selectedElement.type !== 'plugin'
        ? { elementType: selectedElement.type, id: selectedElement.id }
        : null;
    if (stableTarget && isNativeElementId(stableTarget.id)) {
      const target = {
        ...stableTarget,
        patch: { property: 'layerName', value: newLayerName },
      } as const;
      try {
        await patchElementLayerNameById(
          target.elementType,
          target.id,
          target.patch.value,
        );
      } catch (error) {
        console.error('Failed to rename layer', error);
      }
    }
  };

  const handleRenameCancel = () => {
    renameCancelledRef.current = true;
    setIsRenaming(false);
  };

  const prevRenameSignalRef = useRef(renameRequestSignal);
  useEffect(() => {
    if (renameRequestSignal !== prevRenameSignalRef.current) {
      prevRenameSignalRef.current = renameRequestSignal;
      if (
        selectedGroupInfo ||
        singleKeyPosition ||
        singleStatPosition ||
        singleGraphPosition ||
        singleKnobPosition ||
        singleSpritePosition
      ) {
        setPanelMode('property');
        handleRenameStart();
      }
    }
  }, [
    renameRequestSignal,
    selectedGroupInfo,
    singleKeyPosition,
    singleStatPosition,
    singleGraphPosition,
    singleKnobPosition,
    singleSpritePosition,
    setPanelMode,
  ]);

  useEffect(() => {
    setIsRenaming(false);
  }, [selectedElements]);

  return {
    isRenaming,
    renameValue,
    setRenameValue,
    renameInputRef,
    renameCancelledRef,
    handleRenameStart,
    handleRenameCommit,
    handleRenameCancel,
  };
};
