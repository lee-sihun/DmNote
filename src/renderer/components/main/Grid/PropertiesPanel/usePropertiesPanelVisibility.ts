import { useEffect, useRef } from 'react';

type PanelMode = 'layer' | 'property';

interface UsePropertiesPanelVisibilityOptions {
  frameVariant: 'inline' | 'window';
  isPanelVisible: boolean;
  setIsPanelVisible: (visible: boolean) => void;
  panelMode: PanelMode;
  setPanelMode: (mode: PanelMode) => void;
  selectedKeyType: string;
  singleKeyIndex: number;
  selectedElements: readonly unknown[];
  selectedKeyElementsLength: number;
  selectedKeyLikeElementsLength: number;
  selectedBatchStyleElementsLength: number;
  selectedPluginElementsLength: number;
  pluginSettingsPanel: object | null;
  closePage: () => void;
  setShowImagePicker: (visible: boolean) => void;
  setShowGraphImagePicker: (visible: boolean) => void;
  setShowBatchImagePicker: (visible: boolean) => void;
  setBatchPickerFor: (target: null) => void;
}

export const usePropertiesPanelVisibility = ({
  frameVariant,
  isPanelVisible,
  setIsPanelVisible,
  panelMode,
  setPanelMode,
  selectedKeyType,
  singleKeyIndex,
  selectedElements,
  selectedKeyElementsLength,
  selectedKeyLikeElementsLength,
  selectedBatchStyleElementsLength,
  selectedPluginElementsLength,
  pluginSettingsPanel,
  closePage,
  setShowImagePicker,
  setShowGraphImagePicker,
  setShowBatchImagePicker,
  setBatchPickerFor,
}: UsePropertiesPanelVisibilityOptions) => {
  const panelModeRef = useRef(panelMode);
  // eslint-disable-next-line react-hooks/refs -- 이벤트 정산의 최신 패널 모드 유지
  panelModeRef.current = panelMode;
  const prevHasSelectionRef = useRef(false);
  const selectionFromLayerPanelRef = useRef(false);
  const prevKeyTypeRef = useRef(selectedKeyType);
  const keyTypeChangedRef = useRef(false);
  const manuallyClosedRef = useRef(false);

  useEffect(() => {
    if (prevKeyTypeRef.current !== selectedKeyType) {
      keyTypeChangedRef.current = true;
      prevKeyTypeRef.current = selectedKeyType;
    }
  }, [selectedKeyType]);

  useEffect(() => {
    const hasSelection =
      selectedKeyElementsLength > 0 || selectedElements.length > 0;
    const hadSelection = prevHasSelectionRef.current;

    if (pluginSettingsPanel) {
      prevHasSelectionRef.current = hasSelection;
      return;
    }

    if (hasSelection) {
      // 열린 패널의 페이지는 sticky — 레이어 목록 표시 중 캔버스 클릭은 선택만 바꾸고
      // 편집(property) 진입은 더블클릭·목록 더블클릭·헤더 토글만 수행한다 (포토샵식)
      if (!hadSelection) {
        manuallyClosedRef.current = false;
        if (!isPanelVisible) {
          setPanelMode('property');
          setIsPanelVisible(true);
        }
      } else if (!isPanelVisible && !manuallyClosedRef.current) {
        setPanelMode('property');
        setIsPanelVisible(true);
      }
    } else if (hadSelection) {
      if (keyTypeChangedRef.current && isPanelVisible) {
        setPanelMode('layer');
      } else if (
        isPanelVisible &&
        (selectionFromLayerPanelRef.current || panelModeRef.current === 'layer')
      ) {
        setPanelMode('layer');
      } else if (!manuallyClosedRef.current) {
        setIsPanelVisible(false);
      }
    }

    prevHasSelectionRef.current = hasSelection;
    selectionFromLayerPanelRef.current = false;
    keyTypeChangedRef.current = false;

    setShowImagePicker(false);
    setShowGraphImagePicker(false);
    setShowBatchImagePicker(false);
    // 배치 색상 draft는 피커를 열 때 첫 요소에서 한 번만 떠 온다.
    // 열린 채로 선택이 바뀌면 옛 대상 색이 남아 다음 드래그가 그 값을 새 선택에 쓴다
    setBatchPickerFor(null);
    closePage();
  }, [
    singleKeyIndex,
    selectedKeyElementsLength,
    selectedElements,
    isPanelVisible,
    pluginSettingsPanel,
    setIsPanelVisible,
    setPanelMode,
    closePage,
    setShowImagePicker,
    setShowGraphImagePicker,
    setShowBatchImagePicker,
    setBatchPickerFor,
  ]);

  useEffect(() => {
    if (
      isPanelVisible &&
      !pluginSettingsPanel &&
      panelMode === 'property' &&
      selectedKeyElementsLength === 0 &&
      selectedElements.length === 0
    ) {
      setPanelMode('layer');
    }
  }, [
    isPanelVisible,
    pluginSettingsPanel,
    panelMode,
    selectedKeyElementsLength,
    selectedElements,
    setPanelMode,
  ]);

  useEffect(() => {
    if (
      selectedBatchStyleElementsLength + selectedPluginElementsLength > 1 &&
      !isPanelVisible &&
      !manuallyClosedRef.current
    ) {
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [
    selectedBatchStyleElementsLength,
    selectedPluginElementsLength,
    isPanelVisible,
    setIsPanelVisible,
    setPanelMode,
  ]);

  useEffect(() => {
    if (pluginSettingsPanel) {
      manuallyClosedRef.current = false;
      setPanelMode('property');
      setIsPanelVisible(true);
    }
  }, [pluginSettingsPanel, setIsPanelVisible, setPanelMode]);

  useEffect(() => {
    const hasSelection =
      selectedKeyElementsLength > 0 || selectedElements.length > 0;
    if (frameVariant === 'window' || !isPanelVisible || hasSelection) {
      return undefined;
    }

    const handleGridClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const gridContainer = target.closest('[data-grid-container]');
      if (!gridContainer) return;

      if (
        target.closest('[class*="properties-panel"]') ||
        target.closest('[class*="PropertiesPanel"]') ||
        target.closest('.absolute.right-0.top-0.bottom-0')
      ) {
        return;
      }

      if (
        target.closest('[data-key-element]') ||
        target.closest('[data-plugin-element]')
      ) {
        return;
      }

      setIsPanelVisible(false);
    };

    document.addEventListener('mousedown', handleGridClick);
    return () => {
      document.removeEventListener('mousedown', handleGridClick);
    };
  }, [
    frameVariant,
    isPanelVisible,
    selectedKeyElementsLength,
    selectedKeyLikeElementsLength,
    selectedElements.length,
    setIsPanelVisible,
  ]);

  const handleTogglePanelImpl = useRef<() => void>(() => {});
  // eslint-disable-next-line react-hooks/refs -- 안정 래퍼의 최신 토글 콜백 유지
  handleTogglePanelImpl.current = () => {
    const willOpen = !isPanelVisible;

    if (willOpen) {
      manuallyClosedRef.current = false;
      setIsPanelVisible(true);
      const hasSelection = selectedElements.length > 0;
      if (!hasSelection) setPanelMode('layer');
    } else {
      manuallyClosedRef.current = true;
      setIsPanelVisible(false);
      setShowImagePicker(false);
      setShowGraphImagePicker(false);
      setShowBatchImagePicker(false);
    }
  };
  const handleTogglePanel = () => {
    handleTogglePanelImpl.current();
  };

  return { selectionFromLayerPanelRef, handleTogglePanel };
};
