import React, { useRef, useState, useEffect } from 'react';
import {
  closeCustomDialogOwnedSurface,
  replaceCustomDialogCallbacks,
} from './customDialogCallbacks';
import {
  usePanelWindowStore,
  detachPropertiesPanel,
  hasInlinePropertiesPanelLease,
  isTransitionFailure,
} from '@stores/grid/usePanelWindowStore';
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
import RemoteSheetHost from '@components/main/Modal/RemoteSheetHost';
import NoteSettingModal from '@components/main/Modal/content/settings/NoteSetting';
import UpdateModal from '@components/main/Modal/content/dialogs/UpdateModal';
import PropertiesPanel from '@components/main/Grid/PropertiesPanel';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { ShortcutBinding } from '@src/types/settings/shortcuts';
import FloatingPopup from '@components/main/Modal/FloatingPopup';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';
import PopupExit from '@components/main/Modal/PopupExit';
import Palette from '@components/main/Modal/content/pickers/Palette';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { usePluginDisplayElementsResponder } from '@hooks/app/usePluginDisplayElementsResponder';
import {
  useUpdateCheck,
  hasPendingPostUpdateReleaseNotice,
  clearPendingPostUpdateReleaseNotice,
} from '@hooks/app/useUpdateCheck';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import { keysApi } from '@api/modules/keysApi';
import { settingsApi } from '@api/modules/settingsApi';
import { appApi } from '@api/modules/appApi';

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
  useCustomJsInjection(isBootstrapped);
  useAppBootstrap();
  usePluginDisplayElementsResponder();
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
    keyMappings,
    positions,
    handleKeyMappingChange,
    handleResetCurrentMode,
    handleUndo,
    handleRedo,
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
  const panelWindowStatus = usePanelWindowStore((state) => state.status);
  const selectedKeyTypeAtSettingsOpenRef = useRef(selectedKeyType);
  const { value: visualSettingsOpen, toggle: toggleSettingsView } =
    useOptimisticBooleanCommit({
      canonicalValue: isSettingsOpen,
      onCommit: (next) => {
        if (next) {
          selectedKeyTypeAtSettingsOpenRef.current = selectedKeyType;
        } else if (
          selectedKeyTypeAtSettingsOpenRef.current !== selectedKeyType
        ) {
          useGridSelectionStore.getState().clearSelection();
        }
        setIsSettingsOpen(next);
      },
    });
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
    cancelText: undefined as string | undefined,
    danger: false,
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
    onContentMount?: (element: HTMLElement) => void | (() => void);
  }>({
    isOpen: false,
    html: '',
    confirmText: undefined,
    cancelText: undefined,
    showCancel: false,
    onContentMount: undefined,
  });

  // Global Color Picker 상태
  const colorPickerCloseCallbackRef = useRef<(() => void) | null>(null);
  // 콜백은 ref가 아니라 열림 상태에 함께 싣는다. 퇴장 유예 동안 다른 피커가
  // 열리면 ref는 이미 새 주인을 가리켜, 옛 피커의 마지막 커밋이 엉뚱한 대상에 꽂힌다.
  // 상태에 실으면 엘리먼트가 그 세션의 콜백을 그대로 들고 퇴장한다
  const [colorPickerState, setColorPickerState] = useState<{
    isOpen: boolean;
    color: string;
    position?: { x: number; y: number };
    id?: string;
    referenceElement?: HTMLElement;
    onChange?: (color: string) => void;
    onComplete?: (color: string) => void;
  }>({
    isOpen: false,
    color: '#FFFFFF',
    position: undefined,
    id: undefined,
    referenceElement: undefined,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (!matchesShortcut(e, shortcuts?.switchKeyMode)) return;
      // 캔버스 전용 단축키, 설정 화면에서는 기본 Tab 탐색 유지
      if (isSettingsOpen) return;
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
    isSettingsOpen,
    shortcuts?.switchKeyMode,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
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

  // 새 요청이 기존 alert/confirm을 대체할 때 이전 콜백을 settle해 Promise 유실 방지
  const settlePendingDialog = () => {
    const cancel = cancelCallbackRef.current;
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
    cancel?.();
  };

  const showAlert = (
    message: string,
    confirmText?: string,
    onDismiss?: () => void,
  ) => {
    settlePendingDialog();
    // alert는 확인·배경 클릭 어느 경로로 닫혀도 동일하게 settle
    confirmCallbackRef.current = onDismiss ?? null;
    cancelCallbackRef.current = onDismiss ?? null;
    setAlertState({
      isOpen: true,
      message,
      type: 'alert',
      confirmText: confirmText || t('common.confirm'),
      cancelText: undefined,
      danger: false,
    });
  };

  // 정산 실패로 분리하지 못하면 알린다. 조용히 끝나면 버튼이 먹통으로 보인다
  const requestPanelDetach = async () => {
    const outcome = await detachPropertiesPanel();
    if (isTransitionFailure(outcome)) {
      showAlert(t('propertiesPanel.detachFailed'), t('common.ok'));
    }
  };

  const handleUpdatePrimaryAction = async () => {
    if (!updateInfo) return;

    if (!autoUpdateEnabled) {
      try {
        await appApi.openExternal(updateInfo.releaseUrl);
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
    options?: {
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    },
  ) => {
    settlePendingDialog();
    confirmCallbackRef.current =
      typeof onConfirm === 'function' ? onConfirm : null;
    cancelCallbackRef.current =
      typeof options?.onCancel === 'function' ? options.onCancel : null;
    setAlertState({
      isOpen: true,
      message,
      confirmText: options?.confirmText || t('common.confirm'),
      cancelText: options?.cancelText,
      danger: options?.danger ?? false,
      type: 'confirm',
    });
  };

  const closeAlert = () => {
    setAlertState({
      isOpen: false,
      message: '',
      confirmText: t('common.confirm'),
      cancelText: undefined,
      danger: false,
      type: 'alert',
    });
    confirmCallbackRef.current = null;
    cancelCallbackRef.current = null;
  };

  // 닫은 뒤 콜백 실행 — 콜백이 동기적으로 새 다이얼로그를 열어도 닫히지 않게
  const handleAlertConfirm = () => {
    const callback = confirmCallbackRef.current;
    closeAlert();
    callback?.();
  };

  // 노트 설정 모달 수명 - 퇴장 모션이 도는 동안 마운트를 유지한다.
  // 설정값도 같이 붙잡는다. 스토어가 먼저 비면 잔상이 빈 카드가 된다
  const noteSettingOpen = Boolean(
    noteEffect && isNoteSettingOpen && noteSettings,
  );
  const noteSettingPresence = useModalPresence(noteSettingOpen);
  const shownNoteSettings = useRetainedWhileOpen(noteSettingOpen, noteSettings);

  // 닫으면 정보와 최신 여부가 함께 비워진다. isLatestVersion은 모달 화면을
  // 가르는 값이라 따로 두면 퇴장 구간에 반대 화면으로 뒤집힌다 - 한 스냅샷으로 묶는다
  const updateModalOpen = (updateAvailable || isLatestVersion) && !!updateInfo;
  const shownUpdate = useRetainedWhileOpen(updateModalOpen, {
    info: updateInfo,
    isLatestVersion,
  });

  const handleAlertCancel = () => {
    const callback = cancelCallbackRef.current;
    closeAlert();
    callback?.();
  };

  // 언마운트 시 대기 중 다이얼로그 Promise settle (HMR·루트 교체 대비)
  useEffect(
    () => () => {
      const cancel = cancelCallbackRef.current;
      confirmCallbackRef.current = null;
      cancelCallbackRef.current = null;
      cancel?.();
      replaceCustomDialogCallbacks(customDialogCallbackRef, {});
    },
    [],
  );

  // Custom Dialog 핸들러
  const showCustomDialog = (
    html: string,
    options?: {
      onConfirm?: () => void;
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      showCancel?: boolean;
      onContentMount?: (element: HTMLElement) => void | (() => void);
    },
  ) => {
    if (colorPickerState.isOpen) {
      closeCustomDialogOwnedSurface(
        colorPickerState.referenceElement,
        closeColorPicker,
      );
    }
    replaceCustomDialogCallbacks(customDialogCallbackRef, {
      onConfirm: options?.onConfirm,
      onCancel: options?.onCancel,
    });
    setCustomDialogState({
      isOpen: true,
      html,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      showCancel: options?.showCancel ?? false,
      onContentMount: options?.onContentMount,
    });
  };

  const closeCustomDialog = () => {
    // 다이얼로그 내부 앵커에 붙은 전역 피커는 다이얼로그와 함께 정리
    if (colorPickerState.isOpen) {
      closeCustomDialogOwnedSurface(
        colorPickerState.referenceElement,
        closeColorPicker,
      );
    }
    setCustomDialogState({
      isOpen: false,
      html: '',
      confirmText: undefined,
      cancelText: undefined,
      showCancel: false,
      onContentMount: undefined,
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
    colorPickerCloseCallbackRef.current = options.onClose || null;
    setColorPickerState({
      isOpen: true,
      color: options.initialColor,
      position: options.position,
      id: options.id,
      referenceElement: options.referenceElement,
      onChange: options.onColorChange,
      onComplete: options.onColorChangeComplete,
    });
  };

  const closeColorPicker = () => {
    if (colorPickerCloseCallbackRef.current) {
      colorPickerCloseCallbackRef.current();
    }
    // 세션 콜백은 지우지 않는다. 퇴장 중 언마운트 커밋이 아직 남아 있고,
    // 그 커밋은 이 세션의 대상으로 가야 한다
    setColorPickerState((prev) => ({ ...prev, isOpen: false }));
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

  // 콜백을 상태에서 꺼내므로 이 클로저는 열림 세션에 묶인다.
  // 엘리먼트가 붙잡히면 클로저도 함께 붙잡혀 퇴장 구간의 마지막 커밋이 제 대상으로 간다
  const handleGlobalColorChange = (newColor: string) => {
    setColorPickerState((prev) => ({ ...prev, color: newColor }));
    colorPickerState.onChange?.(newColor);
  };

  const handleGlobalColorChangeComplete = (newColor: string) => {
    colorPickerState.onComplete?.(newColor);
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
    <div className="bg-app w-full h-full flex flex-col overflow-hidden rounded-[8px]">
      <TitleBar />
      <div className="flex-1 bg-panel overflow-hidden flex">
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
              keyMappings={keyMappings}
              positions={positions}
              color={color}
              activeTool={activeTool}
              showConfirm={showConfirm}
              showAlert={showAlert}
              onUndo={handleUndo}
              onRedo={handleRedo}
              toolbarAddRequest={toolbarAddRequest}
              onToolbarAddConsumed={() => setToolbarAddRequest(null)}
              isNoteSettingOpen={isNoteSettingOpen}
              setIsNoteSettingOpen={setIsNoteSettingOpen}
            />
            {hasInlinePropertiesPanelLease(panelWindowStatus) && (
              <PropertiesPanel
                onKeyMappingChange={handleKeyMappingChange}
                detachAction="detach"
                onDetachAction={() => void requestPanelDetach()}
              />
            )}
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
            { confirmText: t('confirm.reset') },
          )
        }
        onResetCounters={() =>
          showConfirm(
            t('confirm.resetCountersCurrentTab'),
            async () => {
              await keysApi.resetCountersMode(selectedKeyType);
            },
            { confirmText: t('confirm.reset') },
          )
        }
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        isSettingsOpen={visualSettingsOpen}
        onOpenSettings={toggleSettingsView}
        onCloseSettings={toggleSettingsView}
        showAlert={showAlert}
        onOpenNoteSetting={() => setIsNoteSettingOpen(true)}
        primaryButtonRef={primaryButtonRef}
      />
      {/* 조건부 마운트를 걷어내야 퇴장 모션이 돈다 - 팝업 수명은 FloatingPopup이 소유 */}
      <FloatingPopup
        open={palette}
        ariaLabel={t('tooltip.palette')}
        referenceRef={primaryButtonRef}
        placement="top"
        offset={25}
        onClose={handlePaletteClose}
        // 글래스와 모션은 팝업 표면이 소유 - ListPopup과 같은 구조
        className="dmn-motion z-50 flex flex-col justify-between rounded-popup bg-glass backdrop-glass-popup shadow-elevation-2 p-[8px]"
        contentMountStrategy="after-paint"
      >
        <Palette color={color} onColorChange={handleColorChange} />
      </FloatingPopup>
      {noteSettingPresence.mounted && shownNoteSettings && (
        <NoteSettingModal
          key={noteSettingPresence.cycle}
          motionState={noteSettingPresence.state}
          settings={shownNoteSettings}
          onClose={() => setIsNoteSettingOpen(false)}
          onSave={async (normalized) => {
            try {
              await settingsApi.update({ noteSettings: normalized });
              setNoteSettings(normalized);
            } catch (error) {
              console.error('Failed to update note settings', error);
            }
          }}
        />
      )}
      {/* 분리 패널이 요청한 전면 시트 - 패널 창엔 시트가 들어갈 자리가 없다 */}
      <RemoteSheetHost />
      <CustomAlert
        isOpen={alertState.isOpen}
        message={alertState.message}
        type={alertState.type}
        confirmText={alertState.confirmText}
        cancelText={alertState.cancelText}
        danger={alertState.danger}
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
        onCustomContentMount={customDialogState.onContentMount}
        onConfirm={handleCustomDialogConfirm}
        onCancel={handleCustomDialogCancel}
      />
      <PopupExit open={colorPickerState.isOpen}>
        {colorPickerState.isOpen ? (
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
            closeOnScroll={true}
          />
        ) : null}
      </PopupExit>
      {/* 열림 여부로 걷어내면 퇴장 모션이 돌 자리가 없다 - 수명은 모달이 소유하고
          여기서는 마지막 열림 정보만 붙잡아 잔상이 빈 카드가 되는 걸 막는다 */}
      {shownUpdate.info && (
        <UpdateModal
          isOpen={updateModalOpen}
          updateInfo={shownUpdate.info}
          onClose={handleUpdateModalClose}
          onSkipVersion={skipVersion}
          isLatestVersion={shownUpdate.isLatestVersion}
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
