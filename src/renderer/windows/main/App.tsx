import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import TitleBar from '@components/main/TitleBar';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { useCustomJsInjection } from '@hooks/app/useCustomJsInjection';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import ToolBar from '@components/main/Tool/ToolBar';
import Grid from '@components/main/Grid';
import SettingTab from '@components/main/Settings';
import { useKeyManager } from '@hooks/useKeyManager';
import { usePalette } from '@hooks/Modal/usePalette';
import CustomAlert from '@components/main/Modal/content/dialogs/Alert';
import NoteSettingModal from '@components/main/Modal/content/settings/NoteSetting';
import UpdateModal from '@components/main/Modal/content/dialogs/UpdateModal';
import PropertiesPanel from '@components/main/Grid/PropertiesPanel';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { ShortcutBinding } from '@src/types/settings/shortcuts';
import FloatingPopup from '@components/main/Modal/FloatingPopup';
import Palette from '@components/main/Modal/content/pickers/Palette';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import {
  useUpdateCheck,
  hasPendingPostUpdateReleaseNotice,
  clearPendingPostUpdateReleaseNotice,
} from '@hooks/app/useUpdateCheck';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

import { useUIStore } from '@stores/useUIStore';

type ToolbarAddItemType = 'key' | 'stat' | 'graph' | 'knob';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  }
  return '';
}

export default function App() {
  const setGridAreaHovered = useUIStore((state) => state.setGridAreaHovered);
  const { selectedKeyType, setSelectedKeyType, isBootstrapped } = useKeyStore();
  useCustomCssInjection();
  useCustomJsInjection();
  useAppBootstrap();
  useBlockBrowserShortcuts();

  // 업데이트 체크
  const {
    updateAvailable,
    isLatestVersion,
    updateInfo,
    dismissUpdate,
    skipVersion,
    checkForUpdates,
    runAutoUpdate,
    isAutoUpdating,
  } = useUpdateCheck();

  const [pendingPostUpdateNotice, setPendingPostUpdateNotice] = useState(() =>
    hasPendingPostUpdateReleaseNotice(),
  );

  // 앱 시작 시 업데이트 체크 (자동 업데이트 직후에는 최신 버전 모달을 1회 표시)
  useEffect(() => {
    if (pendingPostUpdateNotice) {
      checkForUpdates(true);
      return;
    }
    checkForUpdates();
  }, [checkForUpdates, pendingPostUpdateNotice]);

  // 윈도우 타입
  useEffect(() => {
    try {
      window.__dmn_window_type = 'main';
    } catch {
      // 무시
    }
    return () => {
      try {
        delete window.__dmn_window_type;
      } catch {
        // 무시
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const disableSpellcheck = () => {
      document.documentElement.spellcheck = false;
      if (document.body) {
        document.body.spellcheck = false;
      }
      document.querySelectorAll('input, textarea').forEach((el) => {
        if (el instanceof HTMLElement) {
          el.setAttribute('spellcheck', 'false');
        }
      });
    };

    disableSpellcheck();

    const observer = new MutationObserver(() => {
      disableSpellcheck();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const primaryButtonRef = useRef(null);

  const {
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
    canUndo,
    canRedo,
  } = useKeyManager();
  const { color, palette, setPalette, handleColorChange, handlePaletteClose } =
    usePalette();

  const [activeTool, setActiveTool] = useState('move');
  const [toolbarAddRequest, setToolbarAddRequest] = useState<{
    id: number;
    type: ToolbarAddItemType;
  } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNoteSettingOpen, setIsNoteSettingOpen] = useState(false);
  const [skipModalAnimationOnReturn, setSkipModalAnimationOnReturn] =
    useState(false);
  const selectedKeyTypeAtSettingsOpenRef = useRef(selectedKeyType);
  const {
    noteEffect,
    angleMode: _angleMode,
    setAngleMode: _setAngleMode,
    language: _storeLanguage,
    setLanguage: _setLanguage,
    noteSettings,
    setNoteSettings,
    autoUpdateEnabled,
    developerModeEnabled,
    shortcuts,
  } = useSettingsStore();

  const matchesShortcut = (event: KeyboardEvent, binding?: ShortcutBinding) => {
    if (!binding?.key) return false;
    const ctrl = !!binding.ctrl;
    const shift = !!binding.shift;
    const alt = !!binding.alt;
    const meta = !!binding.meta;
    return (
      event.code === binding.key &&
      event.ctrlKey === ctrl &&
      event.shiftKey === shift &&
      event.altKey === alt &&
      event.metaKey === meta
    );
  };

  // 개발자 모드 비활성 시 DevTools 단축키 차단
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!developerModeEnabled) {
        const isCtrlShiftI =
          (e.ctrlKey || e.metaKey) &&
          e.shiftKey &&
          (e.key === 'I' || e.key === 'i');
        const isF12 = e.key === 'F12';
        if (isCtrlShiftI || isF12) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [developerModeEnabled]);

  const { t } = useTranslation();
  const confirmCallbackRef = useRef<(() => void) | null>(null);
  const cancelCallbackRef = useRef<(() => void) | null>(null);
  const [alertState, setAlertState] = useState(() => ({
    isOpen: false,
    message: '',
    confirmText: t('common.confirm'),
    type: 'alert' as 'alert' | 'confirm' | 'custom',
  }));

  // Custom Dialog 상태 (HTML 콘텐츠)
  const customDialogCallbackRef = useRef<{
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({});
  const [customDialogState, setCustomDialogState] = useState<{
    isOpen: boolean;
    html: string;
    confirmText?: string;
    cancelText?: string;
    showCancel?: boolean;
  }>({
    isOpen: false,
    html: '',
    confirmText: undefined,
    cancelText: undefined,
    showCancel: false,
  });

  // Global Color Picker 상태
  const colorPickerCallbackRef = useRef<((color: string) => void) | null>(null);
  const colorPickerCompleteCallbackRef = useRef<
    ((color: string) => void) | null
  >(null);
  const colorPickerCloseCallbackRef = useRef<(() => void) | null>(null);
  const [colorPickerState, setColorPickerState] = useState<{
    isOpen: boolean;
    color: string;
    position?: { x: number; y: number };
    id?: string;
    referenceElement?: HTMLElement;
  }>({
    isOpen: false,
    color: '#FFFFFF',
    position: undefined,
    id: undefined,
    referenceElement: undefined,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, shortcuts?.switchKeyMode)) return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = (active.tagName || '').toLowerCase();
        const editable = active.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || editable) return;
      }
      // 모달이 열려있으면 탭 전환 차단
      const hasModal = document.querySelector(
        "[data-dmn-modal-backdrop='true']",
      );
      if (hasModal) return;

      // 키 리스닝 중이면 탭 전환 차단
      if (window.__dmn_isKeyListening) return;

      const defaults = ['4key', '5key', '6key', '8key'];
      if (!isBootstrapped || !defaults.includes(selectedKeyType)) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = defaults.indexOf(selectedKeyType);
      const next = defaults[(idx + 1) % defaults.length];
      setSelectedKeyType(next);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    selectedKeyType,
    setSelectedKeyType,
    isBootstrapped,
    shortcuts?.switchKeyMode,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, shortcuts?.toggleSettingsPanel)) return;
      // 캔버스(그리드) 화면에서만 동작
      if (isSettingsOpen) return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = (active.tagName || '').toLowerCase();
        const editable = active.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || editable) return;
      }

      // 모달이 열려있으면 토글 차단
      const hasModal = document.querySelector(
        "[data-dmn-modal-backdrop='true']",
      );
      if (hasModal) return;

      // 키 리스닝 중이면 토글 차단
      if (window.__dmn_isKeyListening) return;

      e.preventDefault();
      e.stopPropagation();

      usePropertiesPanelStore.getState().requestCanvasPanelToggle();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [shortcuts?.toggleSettingsPanel, isSettingsOpen]);

  const showAlert = (message: string, confirmText?: string) => {
    setAlertState({
      isOpen: true,
      message,
      type: 'alert',
      confirmText: confirmText || t('common.confirm'),
    });
  };

  const handleUpdatePrimaryAction = async () => {
    if (!updateInfo) return;

    if (!autoUpdateEnabled) {
      try {
        await window.api.app.openExternal(updateInfo.releaseUrl);
      } catch (error) {
        console.error('Failed to open release URL', error);
      }
      return;
    }

    try {
      await runAutoUpdate(updateInfo.latestVersion);
    } catch (error) {
      const detail = getErrorMessage(error);
      console.error('Automatic update failed:', error);
      if (detail) {
        showAlert(`${t('update.autoUpdateFailed')}\n${detail}`);
        return;
      }
      showAlert(t('update.autoUpdateFailed'));
    }
  };

  const handleUpdateModalClose = () => {
    if (isLatestVersion && pendingPostUpdateNotice) {
      clearPendingPostUpdateReleaseNotice();
      setPendingPostUpdateNotice(false);
    }
    dismissUpdate();
  };

  const showConfirm = (
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmText = t('common.confirm'),
  ) => {
    confirmCallbackRef.current =
      typeof onConfirm === 'function' ? onConfirm : null;
    cancelCallbackRef.current =
      typeof onCancel === 'function' ? onCancel : null;
    setAlertState({ isOpen: true, message, confirmText, type: 'confirm' });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: '',
      confirmText: t('common.confirm'),
      type: 'alert',
    });
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
  };

  const handleAlertConfirm = () => {
    if (confirmCallbackRef.current) {
      confirmCallbackRef.current();
    }
    closeAlert();
  };

  const handleAlertCancel = () => {
    if (cancelCallbackRef.current) {
      cancelCallbackRef.current();
    }
    closeAlert();
  };

  // Custom Dialog 핸들러
  const showCustomDialog = (
    html: string,
    options?: {
      onConfirm?: () => void;
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      showCancel?: boolean;
    },
  ) => {
    customDialogCallbackRef.current = {
      onConfirm: options?.onConfirm,
      onCancel: options?.onCancel,
    };
    setCustomDialogState({
      isOpen: true,
      html,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      showCancel: options?.showCancel ?? false,
    });
  };

  const closeCustomDialog = () => {
    setCustomDialogState({
      isOpen: false,
      html: '',
      confirmText: undefined,
      cancelText: undefined,
      showCancel: false,
    });
    customDialogCallbackRef.current = {};
  };

  const handleCustomDialogConfirm = () => {
    if (customDialogCallbackRef.current.onConfirm) {
      customDialogCallbackRef.current.onConfirm();
    }
    closeCustomDialog();
  };

  const handleCustomDialogCancel = () => {
    if (customDialogCallbackRef.current.onCancel) {
      customDialogCallbackRef.current.onCancel();
    }
    closeCustomDialog();
  };

  // Global Color Picker 핸들러
  const showColorPickerImpl = useRef<
    (options: {
      initialColor: string;
      onColorChange: (color: string) => void;
      position?: { x: number; y: number };
      id?: string;
      referenceElement?: HTMLElement;
      onClose?: () => void;
      onColorChangeComplete?: (color: string) => void;
    }) => void
  >(() => {});
  const showColorPicker = (options: {
    initialColor: string;
    onColorChange: (color: string) => void;
    position?: { x: number; y: number };
    id?: string;
    referenceElement?: HTMLElement;
    onClose?: () => void;
    onColorChangeComplete?: (color: string) => void;
  }) => {
    showColorPickerImpl.current(options);
  };

  const openColorPickerWithOptions = (options: {
    initialColor: string;
    onColorChange: (color: string) => void;
    position?: { x: number; y: number };
    id?: string;
    referenceElement?: HTMLElement;
    onClose?: () => void;
    onColorChangeComplete?: (color: string) => void;
  }) => {
    colorPickerCallbackRef.current = options.onColorChange;
    colorPickerCompleteCallbackRef.current =
      options.onColorChangeComplete || null;
    colorPickerCloseCallbackRef.current = options.onClose || null;
    setColorPickerState({
      isOpen: true,
      color: options.initialColor,
      position: options.position,
      id: options.id,
      referenceElement: options.referenceElement,
    });
  };

  const closeColorPicker = () => {
    if (colorPickerCloseCallbackRef.current) {
      colorPickerCloseCallbackRef.current();
    }
    setColorPickerState((prev) => ({ ...prev, isOpen: false }));
    colorPickerCallbackRef.current = null;
    colorPickerCompleteCallbackRef.current = null;
    colorPickerCloseCallbackRef.current = null;
  };

  useEffect(() => {
    showColorPickerImpl.current = (options: {
      initialColor: string;
      onColorChange: (color: string) => void;
      position?: { x: number; y: number };
      id?: string;
      referenceElement?: HTMLElement;
      onClose?: () => void;
      onColorChangeComplete?: (color: string) => void;
    }) => {
      // Toggle logic - 이미 열려있으면 닫기만 하고 종료
      if (
        options.id &&
        colorPickerState.isOpen &&
        colorPickerState.id === options.id
      ) {
        closeColorPicker();
        return;
      }

      // 다른 컬러 픽커가 열려있으면 먼저 닫기
      if (colorPickerState.isOpen) {
        closeColorPicker();
        // 약간의 지연 후 새 컬러 픽커 열기 (상태 갱신을 위해)
        setTimeout(() => {
          openColorPickerWithOptions(options);
        }, 0);
        return;
      }

      openColorPickerWithOptions(options);
    };
  });

  const handleGlobalColorChange = (newColor: string) => {
    setColorPickerState((prev) => ({ ...prev, color: newColor }));
    if (colorPickerCallbackRef.current) {
      colorPickerCallbackRef.current(newColor);
    }
  };

  const handleGlobalColorChangeComplete = (newColor: string) => {
    if (colorPickerCompleteCallbackRef.current) {
      colorPickerCompleteCallbackRef.current(newColor);
    }
  };

  const colorPickerStateRef = useRef(colorPickerState);
  useEffect(() => {
    colorPickerStateRef.current = colorPickerState;
  }, [colorPickerState]);
  const getColorPickerState = () => colorPickerStateRef.current;

  // Dialog API를 전역으로 노출
  useEffect(() => {
    window.__dmn_showAlert = showAlert;
    window.__dmn_showConfirm = showConfirm;
    window.__dmn_showCustomDialog = showCustomDialog;
    window.__dmn_showColorPicker = showColorPicker;
    window.__dmn_getColorPickerState = getColorPickerState;

    return () => {
      delete window.__dmn_showAlert;
      delete window.__dmn_showConfirm;
      delete window.__dmn_showCustomDialog;
      delete window.__dmn_showColorPicker;
      delete window.__dmn_getColorPickerState;
    };
  });

  return (
    <div className="bg-[#111012] w-full h-full flex flex-col overflow-hidden rounded-[7px] border border-[rgba(255,255,255,0.1)]">
      <TitleBar />
      <div className="flex-1 bg-[#2A2A31] overflow-hidden flex">
        {isSettingsOpen ? (
          <div className="h-full w-full overflow-y-auto">
            <SettingTab showAlert={showAlert} showConfirm={showConfirm} />
          </div>
        ) : (
          <div
            className="flex-1 h-full overflow-hidden relative"
            onMouseEnter={() => setGridAreaHovered(true)}
            onMouseLeave={() => setGridAreaHovered(false)}
          >
            <Grid
              selectedKey={selectedKey}
              setSelectedKey={setSelectedKey}
              keyMappings={keyMappings}
              positions={positions}
              onPositionChange={handlePositionChange}
              onKeyUpdate={handleKeyUpdate}
              onKeyPreview={handleKeyPreview}
              onNoteColorUpdate={handleNoteColorUpdate}
              onNoteColorPreview={handleNoteColorPreview}
              onCounterUpdate={handleCounterSettingsUpdate}
              onCounterPreview={handleCounterSettingsPreview}
              onKeyDelete={handleDeleteKey}
              onAddKeyAt={handleAddKeyAt}
              onKeyDuplicate={handleDuplicateKey}
              onMoveToFront={handleMoveToFront}
              onMoveToBack={handleMoveToBack}
              onMoveForward={handleMoveForward}
              onMoveBackward={handleMoveBackward}
              color={color}
              activeTool={activeTool}
              showConfirm={showConfirm}
              showAlert={showAlert}
              shouldSkipModalAnimation={skipModalAnimationOnReturn}
              onModalAnimationConsumed={() =>
                setSkipModalAnimationOnReturn(false)
              }
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo}
              canRedo={canRedo}
              toolbarAddRequest={toolbarAddRequest}
              onToolbarAddConsumed={() => setToolbarAddRequest(null)}
              isNoteSettingOpen={isNoteSettingOpen}
              setIsNoteSettingOpen={setIsNoteSettingOpen}
            />
            <PropertiesPanel
              onPositionChange={handlePositionChange}
              onKeyUpdate={(data) => {
                const { index, ...updates } = data;
                handleKeyStyleUpdate(index, updates);
              }}
              onKeyBatchUpdate={handleKeyBatchStyleUpdate}
              onKeyPreview={handleKeyPreview}
              onKeyBatchPreview={handleKeyBatchPreview}
              onKeyMappingChange={handleKeyMappingChange}
            />
          </div>
        )}
      </div>
      <ToolBar
        onAddItem={(type) =>
          setToolbarAddRequest({
            id: Date.now(),
            type,
          })
        }
        onTogglePalette={() => setPalette((p) => !p)}
        isPaletteOpen={palette}
        onResetCurrentMode={() =>
          showConfirm(
            t('confirm.resetCurrentTab'),
            async () => {
              await handleResetCurrentMode();
            },
            undefined,
            t('confirm.reset'),
          )
        }
        onResetCounters={() =>
          showConfirm(
            t('confirm.resetCountersCurrentTab'),
            async () => {
              await window.api.keys.resetCountersMode(selectedKeyType);
            },
            undefined,
            t('confirm.reset'),
          )
        }
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        isSettingsOpen={isSettingsOpen}
        onOpenSettings={() => {
          selectedKeyTypeAtSettingsOpenRef.current = selectedKeyType;
          if (selectedKey) setSkipModalAnimationOnReturn(true);
          setIsSettingsOpen(true);
        }}
        onCloseSettings={() => {
          if (selectedKeyTypeAtSettingsOpenRef.current !== selectedKeyType) {
            useGridSelectionStore.getState().clearSelection();
          }
          setIsSettingsOpen(false);
        }}
        showAlert={showAlert}
        onOpenNoteSetting={() => setIsNoteSettingOpen(true)}
        primaryButtonRef={primaryButtonRef}
      />
      {palette && (
        <FloatingPopup
          open={palette}
          referenceRef={primaryButtonRef}
          placement="top"
          offset={25}
          onClose={handlePaletteClose}
          className="z-50"
        >
          <Palette color={color} onColorChange={handleColorChange} />
        </FloatingPopup>
      )}
      {noteEffect && isNoteSettingOpen && noteSettings && (
        <NoteSettingModal
          settings={noteSettings}
          onClose={() => setIsNoteSettingOpen(false)}
          onSave={async (normalized) => {
            try {
              await window.api.settings.update({ noteSettings: normalized });
              setNoteSettings(normalized);
            } catch (error) {
              console.error('Failed to update note settings', error);
            }
          }}
        />
      )}
      <CustomAlert
        isOpen={alertState.isOpen}
        message={alertState.message}
        type={alertState.type}
        confirmText={alertState.confirmText}
        cancelText={undefined}
        showCancel={undefined}
        onConfirm={handleAlertConfirm}
        onCancel={handleAlertCancel}
      />
      <CustomAlert
        isOpen={customDialogState.isOpen}
        message={customDialogState.html}
        type="custom"
        confirmText={customDialogState.confirmText}
        cancelText={customDialogState.cancelText}
        showCancel={customDialogState.showCancel}
        onConfirm={handleCustomDialogConfirm}
        onCancel={handleCustomDialogCancel}
      />
      {colorPickerState.isOpen && (
        <ColorPicker
          open={colorPickerState.isOpen}
          color={colorPickerState.color}
          onColorChange={handleGlobalColorChange}
          onColorChangeComplete={handleGlobalColorChangeComplete}
          onClose={closeColorPicker}
          position={colorPickerState.position}
          referenceRef={
            colorPickerState.referenceElement
              ? { current: colorPickerState.referenceElement }
              : undefined
          }
          offsetY={colorPickerState.referenceElement ? 10 : -80}
          placement="right"
          solidOnly={true}
        />
      )}
      {(updateAvailable || isLatestVersion) && updateInfo && (
        <UpdateModal
          isOpen={updateAvailable || isLatestVersion}
          updateInfo={updateInfo}
          onClose={handleUpdateModalClose}
          onSkipVersion={skipVersion}
          isLatestVersion={isLatestVersion}
          onPrimaryAction={handleUpdatePrimaryAction}
          primaryActionLabel={
            autoUpdateEnabled
              ? isAutoUpdating
                ? t('update.autoUpdating')
                : t('update.autoUpdate')
              : t('update.goToRelease')
          }
          primaryActionDisabled={isAutoUpdating}
        />
      )}
    </div>
  );
}
