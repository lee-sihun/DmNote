import React, { useRef, useState, useEffect } from 'react';
import {
  useMainDialogRuntime,
  useMainDialogRuntimeLifecycle,
} from './useMainDialogRuntime';
import { useTranslation } from '@contexts/useTranslation';
import TitleBar from '@components/main/TitleBar';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { USER_CSS_SCOPE_SELECTOR } from '@utils/css/scopeUserCss';
import { useCustomJsInjection } from '@hooks/app/useCustomJsInjection';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { usePointerFocusGuard } from '@hooks/ui/usePointerFocusGuard';
import { usePanelCloseRequest } from '@hooks/panel/usePanelCloseRequest';
import ToolBar from '@components/main/Tool/ToolBar';
import Grid from '@components/main/Grid';
import SettingTab from '@components/main/Settings';
import { useKeyManager } from '@hooks/useKeyManager';
import { usePalette } from '@hooks/Modal/usePalette';
import CustomAlert from '@components/main/Modal/content/dialogs/Alert';
import NoteSettingModal from '@components/main/Modal/content/settings/NoteSetting';
import UpdateModal from '@components/main/Modal/content/dialogs/UpdateModal';
import { resolveAutoUpdateActionLabel } from '@components/main/Modal/content/dialogs/updateActionLabel';
import PropertiesPanelHost from '@components/main/Grid/PropertiesPanelHost';
import { isModalLayerActive } from '@components/main/Modal/popupLayer';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { ShortcutBinding } from '@src/types/settings/shortcuts';
import FloatingPopup from '@components/main/Modal/floatingPopup/FloatingPopup';
import { CANVAS_POPUP_CHROME_CLASS } from '@components/main/Modal/popupChrome';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';
import PopupExit from '@components/main/Modal/PopupExit';
import Palette from '@components/main/Modal/content/pickers/color/Palette';
import ColorPicker from '@components/main/Modal/content/pickers/color/ColorPicker';
import { useKeyStore } from '@stores/data/useKeyStore';
import { orderedTabIds } from '@utils/tabOrder';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { usePluginDisplayElementsResponder } from '@hooks/app/usePluginDisplayElementsResponder';
import {
  UpdateInstalledRestartFailedError,
  useUpdateCheck,
  hasPendingPostUpdateReleaseNotice,
  clearPendingPostUpdateReleaseNotice,
} from '@hooks/app/useUpdateCheck';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { usePanelHostStore } from '@stores/grid/usePanelHostStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import { keysApi } from '@api/modules/editor/keysApi';
import { settingsApi } from '@api/modules/app/settingsApi';
import { appApi } from '@api/modules/app/appApi';

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
  const {
    selectedKeyType,
    setSelectedKeyType,
    isBootstrapped,
    tabOrder,
    customTabs,
  } = useKeyStore();
  // 메인창은 그리드 미리보기 영역에만 유저 CSS 적용 - 에디터 크롬은 순정 유지
  useCustomCssInjection({ scopeSelector: USER_CSS_SCOPE_SELECTOR });
  useCustomJsInjection(isBootstrapped);
  useAppBootstrap();
  usePluginDisplayElementsResponder();
  useBlockBrowserShortcuts();
  // 클릭 잔류 포커스 무해화 - 키 상시 입력 앱이라 Space/Enter 재활성화 차단
  usePointerFocusGuard();

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
    autoUpdatePhase,
    autoUpdateProgress,
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
  const gridAreaRef = useRef<HTMLDivElement | null>(null);

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
  const panelPlacement = usePanelHostStore((state) => state.placement);
  const [isNoteSettingOpen, setIsNoteSettingOpen] = useState(false);
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
  const dialogRuntime = useMainDialogRuntime({ t });
  const {
    alertState,
    customDialogState,
    colorPickerState,
    showAlert,
    showConfirm,
    handleAlertConfirm,
    handleAlertCancel,
    handleCustomDialogConfirm,
    handleCustomDialogCancel,
    closeColorPicker,
    handleGlobalColorChange,
    handleGlobalColorChangeComplete,
  } = dialogRuntime;

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
      if (isModalLayerActive()) return;

      // 키 리스닝 중이면 탭 전환 차단
      if (window.__dmn_isKeyListening) return;

      // 순환 순서는 사용자가 정한 표시 순서를 따른다. 내장 배열로 돌면
      // 커스텀 탭에서는 아무 일도 안 일어나고 화면 순서와도 어긋난다
      const order = orderedTabIds(tabOrder, customTabs);
      const idx = order.indexOf(selectedKeyType);
      if (!isBootstrapped || idx < 0) return;
      e.preventDefault();
      e.stopPropagation();
      setSelectedKeyType(order[(idx + 1) % order.length]);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    selectedKeyType,
    setSelectedKeyType,
    isBootstrapped,
    isSettingsOpen,
    shortcuts?.switchKeyMode,
    tabOrder,
    customTabs,
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
      if (isModalLayerActive()) return;

      // 키 리스닝 중이면 토글 차단
      if (window.__dmn_isKeyListening) return;

      e.preventDefault();
      e.stopPropagation();

      usePropertiesPanelStore.getState().requestCanvasPanelToggle();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [shortcuts?.toggleSettingsPanel, isSettingsOpen]);

  // 정산 실패로 분리/도킹하지 못하면 알린다. 조용히 끝나면 버튼이 먹통으로 보인다
  const handlePanelTransitionFailure = (kind: 'detach' | 'dock') => {
    showAlert(
      t(
        kind === 'detach'
          ? 'propertiesPanel.detachFailed'
          : 'propertiesPanel.attachFailed',
      ),
      t('common.ok'),
    );
  };

  // 설정 화면에서도 분리 패널의 네이티브 닫기 요청 처리 유지
  usePanelCloseRequest(() => handlePanelTransitionFailure('dock'));

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
      if (error instanceof UpdateInstalledRestartFailedError) {
        // 대개 에디터 저장 실패로 재시작이 취소된 경우 — 원인을 함께 보여줌
        console.error(
          'Update installed but restart failed:',
          error.originalError,
        );
        const restartDetail = getErrorMessage(error.originalError);
        showAlert(
          restartDetail
            ? `${t('update.installedRestartFailed')}\n${restartDetail}`
            : t('update.installedRestartFailed'),
        );
        return;
      }
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

  useMainDialogRuntimeLifecycle(dialogRuntime);

  return (
    <div className="bg-app w-full h-full flex flex-col overflow-hidden rounded-[8px]">
      <TitleBar />
      <div className="flex-1 bg-panel overflow-hidden flex relative">
        {isSettingsOpen ? (
          <div className="h-full w-full overflow-y-auto">
            <SettingTab showAlert={showAlert} showConfirm={showConfirm} />
          </div>
        ) : (
          <div
            ref={gridAreaRef}
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
          </div>
        )}
        {(!isSettingsOpen || panelPlacement === 'detached') && (
          <PropertiesPanelHost
            dockAreaRef={gridAreaRef}
            onKeyMappingChange={handleKeyMappingChange}
            onTransitionFailure={handlePanelTransitionFailure}
          />
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
        onClosePalette={handlePaletteClose}
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
        // 글래스와 모션은 팝업 표면이 소유 - ListPopup과 같은 구조.
        // 패딩 9 = 스와치 그리드 갭 8 + inset 링 1 보정
        className={`dmn-motion z-[var(--z-chrome-modal)] flex flex-col justify-between rounded-popup ${CANVAS_POPUP_CHROME_CLASS} p-[9px]`}
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
          primaryActionLabel={resolveAutoUpdateActionLabel({
            autoUpdateEnabled,
            isAutoUpdating,
            phase: autoUpdatePhase,
            progress: autoUpdateProgress,
            t,
          })}
          primaryActionDisabled={isAutoUpdating}
        />
      )}
    </div>
  );
}
