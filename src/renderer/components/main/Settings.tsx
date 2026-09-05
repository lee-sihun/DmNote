import React, { useEffect, useRef, useState } from 'react';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import Dropdown from '@components/main/common/Dropdown';
import ReloadButton from '@components/main/common/ReloadButton';
import {
  SettingCard,
  SettingRow,
  SettingToggleRow,
} from '@components/main/common/SettingRow';
import { PluginDataDeleteModal } from '@components/main/Modal/content/dialogs/PluginDataDeleteModal';
import { useDeferredHover } from '@hooks/ui/useDeferredHover';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';
import SettingsPreview from '@components/main/SettingsPreview';
import SettingsSidePanel from '@components/main/SettingsPanel/SettingsSidePanel';
import type { SettingsPanelKey } from '@components/main/SettingsPanel/SettingsSidePanel';
import ShortcutsPanelContent from '@components/main/SettingsPanel/ShortcutsPanelContent';
import PluginsPanelContent from '@components/main/SettingsPanel/PluginsPanelContent';
import CssPanelContent from '@components/main/SettingsPanel/CssPanelContent';
import KeySoundOutputSettings from '@components/main/SettingsPanel/KeySoundOutputSettings';
import { createSettingsPluginLifecycleController } from '@components/main/settingsPluginLifecycleController';
import type { PluginToDelete } from '@components/main/settingsPluginLifecycleController';
import {
  FILL_DISABLED_CLASS,
  FILL_INTERACTIVE_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { applyCounterSnapshot } from '@stores/signals/keyCounterSignals';
import { getPluginDisplayName } from '@utils/plugin/pluginUtils';
import { isMac } from '@utils/core/platform';
import { useUpdateCheck } from '@hooks/app/useUpdateCheck';
import { useObsSettingsController } from '@components/main/useObsSettingsController';
import { useOverlayResizeAnchorController } from '@components/main/useOverlayResizeAnchorController';
import type { OverlayResizeAnchor } from '@src/types/settings/settings';
import type { ShortcutsState } from '@src/types/settings/shortcuts';
import type { SupportedLocale } from '@contexts/I18nContextDef';
import type { KeysResetAllResponse } from '@src/types/plugin/api';
import type { KeyCounters } from '@src/types/key/keys';
import { settingsApi } from '@api/modules/settingsApi';
import { overlayApi } from '@api/modules/overlayApi';
import { cssApi } from '@api/modules/cssApi';
import { jsApi } from '@api/modules/jsApi';
import { keysApi } from '@api/modules/keysApi';
import { appApi, windowApi } from '@api/modules/appApi';
import { assertCanonicalEditorDocument } from '@src/types/editor';

interface SettingsProps {
  showAlert: (msg: string, confirmText?: string) => void;
  showConfirm: (
    msg: string,
    onConfirm: () => void | Promise<void>,
    options?: {
      onCancel?: () => void;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    },
  ) => void;
}

const Settings = ({
  showAlert,
  showConfirm,
}: SettingsProps): React.ReactElement => {
  const { t, i18n } = useTranslation();
  const isMacOS: boolean = isMac();
  const {
    hardwareAcceleration,
    setHardwareAcceleration,
    alwaysOnTop,
    setAlwaysOnTop,
    overlayLocked,
    setOverlayLocked,
    angleMode,
    setAngleMode,
    noteEffect,
    setNoteEffect,
    trayEnabled,
    setTrayEnabled,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    developerModeEnabled,
    setDeveloperModeEnabled,
    useCustomCSS,
    setUseCustomCSS,
    customCSSPath,
    customCSSContent,
    useCustomJS,
    setUseCustomJS,
    jsPlugins,
    language,
    setLanguage,
    overlayResizeAnchor,
    setOverlayResizeAnchor,
    keyCounterEnabled,
    setKeyCounterEnabled,
    shortcuts,
    setShortcuts,
  } = useSettingsStore();

  const { checkForUpdates, isChecking } = useUpdateCheck();

  const [hoveredKey, hoverPreview] = useDeferredHover();
  const [activeSettingsPanel, setActiveSettingsPanel] =
    useState<SettingsPanelKey | null>(null);
  // CSS 패널 헤더 개수 배지용 (패널 콘텐츠가 보고)
  const [cssHistoryCount, setCssHistoryCount] = useState<number>(0);
  const [isDataDeleteModalOpen, setDataDeleteModalOpen] =
    useState<boolean>(false);
  const [pluginToDelete, setPluginToDelete] = useState<PluginToDelete | null>(
    null,
  );
  // 닫으면 대상도 함께 비워진다. 퇴장 구간에 쓸 값은 붙잡아 둔다
  const dataDeleteModalOpen = isDataDeleteModalOpen && !!pluginToDelete;
  const shownPluginToDelete = useRetainedWhileOpen(
    dataDeleteModalOpen,
    pluginToDelete,
  );
  const [isReloadingPlugins, setIsReloadingPlugins] = useState<boolean>(false);
  const [isAddingPlugins, setIsAddingPlugins] = useState<boolean>(false);
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);
  const reloadingPluginsRef = useRef(false);
  const addingPluginsRef = useRef(false);
  const pendingPluginRef = useRef<string | null>(null);
  const removingPluginRef = useRef<string | null>(null);
  const resetAllRef = useRef(false);
  const angleModeChangeRef = useRef(false);
  const enqueueResizeAnchor = useOverlayResizeAnchorController({
    overlayResizeAnchor,
    setOverlayResizeAnchor,
    t,
    showAlert,
  });

  // Lenis smooth scroll 적용 (전역 설정 사용)
  const { scrollContainerRef } = useLenis();

  const RESIZE_ANCHOR_OPTIONS: { value: string; key: string }[] = [
    { value: 'top-left', key: 'topLeft' },
    { value: 'bottom-left', key: 'bottomLeft' },
    { value: 'top-right', key: 'topRight' },
    { value: 'bottom-right', key: 'bottomRight' },
    { value: 'center', key: 'center' },
    // 미완성 기능
    // { value: "fixed-position", key: "fixedPosition" },
  ];

  const ANGLE_OPTIONS: { value: string; label: string }[] = [
    { value: 'skia', label: 'Skia' },
    { value: 'd3d11', label: 'Direct3D 11' },
    { value: 'd3d9', label: 'Direct3D 9' },
    { value: 'gl', label: 'OpenGL' },
  ];

  const macAngleOptions: { value: string; label: string }[] = [
    { value: 'metal', label: 'Metal' },
  ];

  useEffect(() => {
    if (isMacOS && angleMode !== 'metal') {
      setAngleMode('metal');
    }
  }, [isMacOS, angleMode, setAngleMode]);

  const {
    obsStatus,
    handleObsToggle,
    handleObsCopyUrl,
    handleObsRegenerateToken,
  } = useObsSettingsController({ t, showAlert, showConfirm });

  const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
    { value: 'ko', label: '한국어' },
    { value: 'en', label: 'English' },
    { value: 'zh-cn', label: '简体中文' },
    { value: 'zh-Hant', label: '繁體中文' },
    { value: 'ru', label: 'Русский' },
  ];

  const _handleHardwareAccelerationChange = (): void => {
    const next: boolean = !hardwareAcceleration;

    const apply = async (): Promise<void> => {
      setHardwareAcceleration(next);
      try {
        await settingsApi.update({ hardwareAcceleration: next });
        await appApi.restart();
      } catch (error) {
        console.error('Failed to toggle hardware acceleration', error);
      }
    };

    if (showConfirm) {
      showConfirm(t('settings.restartConfirm'), apply);
    } else {
      apply();
    }
  };

  const handleAlwaysOnTopChange = async (): Promise<void> => {
    const next: boolean = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      await settingsApi.update({ alwaysOnTop: next });
    } catch (error) {
      setAlwaysOnTop(!next);
      console.error('Failed to toggle always-on-top', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleOverlayLockChange = async (): Promise<void> => {
    const next: boolean = !overlayLocked;
    setOverlayLocked(next);
    try {
      await overlayApi.setLock(next);
    } catch (error) {
      setOverlayLocked(!next);
      console.error('Failed to toggle overlay lock', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleToggleCustomCSS = async (): Promise<void> => {
    const next: boolean = !useCustomCSS;
    setUseCustomCSS(next);
    try {
      await cssApi.toggle(next);
    } catch (error) {
      setUseCustomCSS(!next);
      console.error('Failed to toggle custom CSS', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleToggleCustomJS = async (): Promise<void> => {
    const next: boolean = !useCustomJS;
    setUseCustomJS(next);
    try {
      await jsApi.toggle(next);
    } catch (error) {
      setUseCustomJS(!next);
      console.error('Failed to toggle custom JS', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const {
    canReloadPlugins,
    handleReloadPlugins,
    handleAddPlugins,
    handlePluginToggle,
    handlePluginRemove,
    removePluginOnly,
    removePluginWithData,
  } = createSettingsPluginLifecycleController({
    t,
    showAlert,
    jsPlugins,
    setPluginToDelete,
    setDataDeleteModalOpen,
    setIsReloadingPlugins,
    setIsAddingPlugins,
    setPendingPluginId,
    reloadingPluginsRef,
    addingPluginsRef,
    pendingPluginRef,
    removingPluginRef,
  });

  const actionButtonClass = (enabled: boolean): string =>
    'inline-flex items-center h-[23px] px-[10px] rounded-md text-body transition-colors duration-fast ' +
    (enabled ? FILL_INTERACTIVE_CLASS : FILL_DISABLED_CLASS);

  // 커스텀 i18n에 복수형 처리가 없어 1개는 전용 키 사용
  const panelCountBadge = (count: number): string =>
    count === 1
      ? t('settings.panelCountBadgeOne')
      : t('settings.panelCountBadge', { count: String(count) });

  const handleNoteEffectChange = async (): Promise<void> => {
    const next: boolean = !noteEffect;
    setNoteEffect(next);
    try {
      await settingsApi.update({ noteEffect: next });
    } catch (error) {
      setNoteEffect(!next);
      console.error('Failed to toggle note effect', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleApplyShortcuts = async (next: ShortcutsState): Promise<void> => {
    setShortcuts(next);
    try {
      await settingsApi.update({ shortcuts: next });
    } catch (error) {
      console.error('Failed to update shortcuts', error);
      showAlert?.(t('shortcutSetting.saveFailed'));
      // 저장 실패가 daemon 재시작 실패일 수도 있어 로컬 롤백 대신 authoritative 상태 재조회
      try {
        const state = await window.api.settings.get();
        setShortcuts(state.shortcuts);
      } catch (syncError) {
        console.error('Failed to resync shortcuts', syncError);
      }
    }
  };

  const handleAngleModeChangeSelect = (val: string): void => {
    if (isMacOS || angleModeChangeRef.current) return;
    angleModeChangeRef.current = true;
    const apply = async (): Promise<void> => {
      let saved = false;
      try {
        await settingsApi.update({ angleMode: val });
        saved = true;
        setAngleMode(val);
        await appApi.restart();
      } catch (error) {
        console.error('Failed to change angle mode', error);
        showAlert(t(saved ? 'common.restartFailed' : 'common.saveFailed'));
      } finally {
        angleModeChangeRef.current = false;
      }
    };

    if (showConfirm) {
      showConfirm(t('settings.restartConfirm'), apply, {
        onCancel: () => {
          angleModeChangeRef.current = false;
        },
      });
    } else {
      void apply();
    }
  };

  const handleTrayToggle = async (): Promise<void> => {
    const next: boolean = !trayEnabled;
    setTrayEnabled(next);
    try {
      await settingsApi.update({ trayEnabled: next });
    } catch (error) {
      setTrayEnabled(!next);
      console.error('Failed to toggle tray mode', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleAutoUpdateToggle = async (): Promise<void> => {
    const next: boolean = !autoUpdateEnabled;
    setAutoUpdateEnabled(next);
    try {
      await settingsApi.update({ autoUpdateEnabled: next });
    } catch (error) {
      setAutoUpdateEnabled(!next);
      console.error('Failed to toggle auto update', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleDeveloperModeToggle = async (): Promise<void> => {
    const next: boolean = !developerModeEnabled;
    setDeveloperModeEnabled(next);
    try {
      await settingsApi.update({ developerModeEnabled: next });
      // 개발자 모드가 활성화되면 즉시 DevTools 오픈 (메인 & 오버레이)
      if (next) {
        try {
          await windowApi.openDevtoolsAll?.();
        } catch {}
      }
    } catch (error) {
      setDeveloperModeEnabled(!next);
      console.error('Failed to toggle developer mode', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const handleKeyCounterToggle = async (): Promise<void> => {
    const next: boolean = !keyCounterEnabled;
    setKeyCounterEnabled(next);
    try {
      await settingsApi.update({ keyCounterEnabled: next });
    } catch (error) {
      setKeyCounterEnabled(!next);
      console.error('Failed to toggle key counter', error);
      showAlert(t('common.saveFailed'));
    }
  };

  const _handleResetCounters = async (
    event: React.MouseEvent,
  ): Promise<void> => {
    event.stopPropagation();
    try {
      const snapshot: KeyCounters = await keysApi.resetCounters();
      applyCounterSnapshot(snapshot);
      showAlert?.(t('settings.counterReset'));
    } catch (error) {
      console.error('Failed to reset key counters', error);
      showAlert?.(t('settings.counterResetFailed'));
    }
  };

  const handleResetAll = (): void => {
    if (resetAllRef.current) return;
    resetAllRef.current = true;
    const reset = async (): Promise<void> => {
      // 응답 스냅샷은 커밋 시점 값이다. 기다리는 사이 권위 이벤트가 들어오면
      // 탭 메타데이터는 그쪽이 더 새롭다
      const generation = useKeyStore.getState().tabMetadataGeneration;
      const selectionGeneration = useKeyStore.getState().selectionGeneration;
      try {
        const result: KeysResetAllResponse = await keysApi.resetAll();
        if (result) {
          const candidate = {
            schemaVersion: 1 as const,
            keys: result.keys,
            keyPositions: result.positions,
            statPositions: useStatItemStore.getState().positions,
            graphPositions: useGraphItemStore.getState().positions,
            knobPositions: useKnobItemStore.getState().positions,
            spritePositions: useSpriteStore.getState().positions,
            layerGroups: useLayerGroupStore.getState().layerGroups,
          };
          assertCanonicalEditorDocument(candidate, 'keys_reset_all response');
          // 리셋 직후 메모리 상태도 바로 초기값으로 변경
          useKeyStore.setState({
            keyMappings: result.keys,
            positions: candidate.keyPositions,
            canonicalPositions: candidate.keyPositions,
          });
          // 탭 메타데이터는 세대 계약을 탄다. 응답에 tabOrder·barCount가 실려 오는데
          // 안 읽으면 tabOrder에 방금 지워진 커스텀 id가 남는다
          useKeyStore.getState().setTabMetadata(
            {
              customTabs: result.customTabs,
              tabOrder: result.tabOrder,
              barCount: result.barCount,
            },
            generation,
          );
          // 선택은 세대가 따로다. keys:mode-changed는 순서를 안 건드린다
          if (
            useKeyStore.getState().selectionGeneration === selectionGeneration
          ) {
            useKeyStore
              .getState()
              .commitSelectedKeyType(result.selectedKeyType);
          }
          // 초기화 이전 요소를 가리키는 stale 선택 제거 — 패널이 무효 대상에 쓰는 것 방지
          useGridSelectionStore.getState().clearSelection();
        }
      } catch (error) {
        console.error('Failed to reset presets', error);
        showAlert(t('common.actionFailed'));
      } finally {
        resetAllRef.current = false;
      }
    };

    if (showConfirm) {
      showConfirm(t('settings.resetAllConfirm'), reset, {
        confirmText: t('settings.initialize'),
        onCancel: () => {
          resetAllRef.current = false;
        },
      });
    } else {
      reset();
    }
  };

  const { run: handleLanguageChange, pending: languagePending } =
    useSingleFlightAction(async (val: string) => {
      try {
        await i18n.changeLanguage(val as SupportedLocale);
        setLanguage(val);
      } catch (error) {
        console.error('Failed to change language', error);
        showAlert(t('common.saveFailed'));
      }
    });

  return (
    <div className="relative w-full h-full">
      <div
        ref={scrollContainerRef}
        className="settings-content-scroll w-full h-full flex flex-col py-[12px] px-[12px] gap-[12px] overflow-y-auto bg-panel"
      >
        {/* 설정 */}
        <div className="flex flex-row gap-[12px]">
          <div className="flex flex-col gap-[12px] w-[348px]">
            {/* 키뷰어 설정 */}
            <SettingCard>
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.overlayLock')}
                checked={overlayLocked}
                onToggle={handleOverlayLockChange}
                onMouseEnter={() => hoverPreview('overlayLock')}
                onMouseLeave={() => hoverPreview(null)}
              />
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.alwaysOnTop')}
                checked={alwaysOnTop}
                onToggle={handleAlwaysOnTopChange}
                onMouseEnter={() => hoverPreview('alwaysOnTop')}
                onMouseLeave={() => hoverPreview(null)}
              />
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.noteEffect')}
                checked={noteEffect}
                onToggle={handleNoteEffectChange}
                onMouseEnter={() => hoverPreview('noteEffect')}
                onMouseLeave={() => hoverPreview(null)}
              />
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.keyCounter')}
                checked={keyCounterEnabled}
                onToggle={handleKeyCounterToggle}
                onMouseEnter={() => hoverPreview('keyCounter')}
                onMouseLeave={() => hoverPreview(null)}
              />
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.trayEnabled')}
                checked={trayEnabled}
                onToggle={handleTrayToggle}
                onMouseEnter={() => hoverPreview('trayEnabled')}
                onMouseLeave={() => hoverPreview(null)}
              />
              <SettingRow
                label={t('settings.resizeAnchor')}
                onMouseEnter={() => hoverPreview('resizeAnchor')}
                onMouseLeave={() => hoverPreview(null)}
              >
                <Dropdown
                  options={RESIZE_ANCHOR_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: t(`settings.${opt.key}`),
                  }))}
                  value={overlayResizeAnchor}
                  onChange={(val: string) =>
                    enqueueResizeAnchor(val as OverlayResizeAnchor)
                  }
                  placeholder={t('settings.selectAnchor')}
                  align="right"
                />
              </SettingRow>
            </SettingCard>
            {/* 커스텀 CSS & JS 설정 */}
            <SettingCard>
              <div
                onMouseEnter={() => hoverPreview('customCSS')}
                onMouseLeave={() => hoverPreview(null)}
              >
                <SettingRow label={t('settings.customCSSLabel')}>
                  <button
                    onClick={() =>
                      setActiveSettingsPanel((prev) =>
                        prev === 'css' ? null : 'css',
                      )
                    }
                    className={actionButtonClass(true)}
                  >
                    {t('settings.manageCss')}
                  </button>
                </SettingRow>
              </div>
              <div
                onMouseEnter={() => hoverPreview('customJS')}
                onMouseLeave={() => hoverPreview(null)}
              >
                <SettingRow label={t('settings.customJSLabel')}>
                  <div className="flex flex-row gap-[6px]">
                    <ReloadButton
                      onClick={handleReloadPlugins}
                      disabled={!canReloadPlugins}
                      busy={isReloadingPlugins}
                      title={t('settings.reloadPlugins')}
                    />
                    <button
                      onClick={() =>
                        setActiveSettingsPanel((prev) =>
                          prev === 'plugins' ? null : 'plugins',
                        )
                      }
                      className={actionButtonClass(true)}
                    >
                      {t('settings.managePlugins')}
                    </button>
                  </div>
                </SettingRow>
              </div>
            </SettingCard>
            {/* OBS 모드 */}
            <SettingCard
              onMouseEnter={() => hoverPreview('obsMode')}
              onMouseLeave={() => hoverPreview(null)}
            >
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.obsMode')}
                checked={obsStatus.running}
                onToggle={handleObsToggle}
              />
              <SettingRow
                label={
                  <p
                    className={
                      'text-body ' +
                      (obsStatus.running ? 'text-fg-muted' : 'text-fg-disabled')
                    }
                  >
                    {obsStatus.running
                      ? obsStatus.clientCount > 0
                        ? `${t('settings.obsRunning')} · ${t(
                            'settings.obsClients',
                            { count: obsStatus.clientCount },
                          )}`
                        : t('settings.obsRunning')
                      : t('settings.obsStopped')}
                  </p>
                }
              >
                <div className="flex items-center gap-[6px]">
                  <ReloadButton
                    onClick={handleObsRegenerateToken}
                    disabled={!obsStatus.running}
                    title={t('settings.obsTokenRegen')}
                  />
                  <button
                    onClick={handleObsCopyUrl}
                    disabled={!obsStatus.running}
                    className={actionButtonClass(obsStatus.running)}
                  >
                    {t('settings.obsCopyUrl')}
                  </button>
                </div>
              </SettingRow>
            </SettingCard>
            {/* 키음 출력 설정 */}
            <KeySoundOutputSettings
              onMouseEnter={() => hoverPreview('keySoundOutput')}
              onMouseLeave={() => hoverPreview(null)}
              onSaveFailed={() => showAlert(t('common.saveFailed'))}
            />
            {/* 기타 설정 */}
            <SettingCard>
              <SettingRow label={t('settings.language')}>
                <Dropdown
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={handleLanguageChange}
                  disabled={languagePending}
                  placeholder={t('settings.selectLanguage')}
                  align="right"
                />
              </SettingRow>
              <SettingRow label={t('settings.shortcuts')}>
                <button
                  onClick={() =>
                    setActiveSettingsPanel((prev) =>
                      prev === 'shortcuts' ? null : 'shortcuts',
                    )
                  }
                  className={actionButtonClass(true)}
                >
                  {t('settings.configure')}
                </button>
              </SettingRow>
              <SettingRow label={t('settings.graphicsOption')}>
                <Dropdown
                  options={isMacOS ? macAngleOptions : ANGLE_OPTIONS}
                  value={isMacOS ? 'metal' : angleMode}
                  onChange={handleAngleModeChangeSelect}
                  placeholder={t('settings.renderMode')}
                  disabled={isMacOS}
                  align="right"
                />
              </SettingRow>
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.autoUpdate')}
                checked={autoUpdateEnabled}
                onToggle={handleAutoUpdateToggle}
              />
              <SettingToggleRow
                commitStrategy="after-paint"
                label={t('settings.developerMode')}
                checked={developerModeEnabled}
                onToggle={handleDeveloperModeToggle}
              />
              {/* 버전 및 설정 초기화 */}
              <div className="flex justify-between items-center py-[10px] px-[10px] bg-inset rounded-md mt-[8px] mb-[8px]">
                <p className="text-body text-fg-muted tabular-nums">
                  Ver {__APP_VERSION__}
                </p>
                <div className="flex gap-[8px]">
                  <button
                    className="inline-flex items-center h-[23px] px-[10px] rounded-md text-body text-fg bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => checkForUpdates(true)}
                    disabled={isChecking}
                  >
                    {isChecking
                      ? t('update.checking')
                      : t('update.checkUpdate')}
                  </button>
                  <button
                    className="inline-flex items-center h-[23px] px-[10px] rounded-md text-body text-danger-fg bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active transition-colors duration-fast"
                    onClick={handleResetAll}
                  >
                    {t('settings.resetData')}
                  </button>
                </div>
              </div>
            </SettingCard>
          </div>
        </div>
      </div>
      {/* 우측 고정 콘텐츠 페인 - 기본은 튜토리얼 프리뷰, 선택 시 설정 상세가 같은 표면을 채움 */}
      <div
        className={
          'absolute top-[12px] right-[12px] bottom-[12px] left-[372px] bg-fill-faint rounded-surface overflow-hidden' +
          (activeSettingsPanel ? '' : ' pointer-events-none')
        }
      >
        {!activeSettingsPanel && <SettingsPreview hoveredKey={hoveredKey} />}
        {activeSettingsPanel && (
          <SettingsSidePanel
            activePanel={activeSettingsPanel}
            onClose={() => setActiveSettingsPanel(null)}
            pages={[
              {
                key: 'shortcuts',
                title: t('shortcutSetting.title'),
                content: (
                  <ShortcutsPanelContent
                    shortcuts={shortcuts}
                    onApply={handleApplyShortcuts}
                    onClose={() => setActiveSettingsPanel(null)}
                  />
                ),
              },
              {
                key: 'plugins',
                title: t('settings.managePluginsTitle'),
                headerBadge: panelCountBadge(jsPlugins.length),
                content: (
                  <PluginsPanelContent
                    plugins={jsPlugins}
                    useCustomJS={useCustomJS}
                    onToggleCustomJS={handleToggleCustomJS}
                    onAdd={handleAddPlugins}
                    onToggle={handlePluginToggle}
                    onRemove={handlePluginRemove}
                    isAdding={isAddingPlugins}
                    isPluginActionPending={pendingPluginId !== null}
                    onClose={() => setActiveSettingsPanel(null)}
                  />
                ),
              },
              {
                key: 'css',
                title: t('settings.manageCssTitle'),
                headerBadge: panelCountBadge(cssHistoryCount),
                content: (
                  <CssPanelContent
                    useCustomCSS={useCustomCSS}
                    customCSSPath={customCSSPath}
                    customCSSContent={customCSSContent}
                    onToggleCustomCSS={handleToggleCustomCSS}
                    showAlert={(msg: string) => showAlert?.(msg)}
                    onClose={() => setActiveSettingsPanel(null)}
                    onHistoryCountChange={setCssHistoryCount}
                  />
                ),
              },
            ]}
          />
        )}
      </div>
      {/* 열림 여부로 걷어내면 퇴장 모션이 돌 자리가 없다 - 수명은 모달이 소유하고
          여기서는 마지막 열림 대상만 붙잡아 잔상이 빈 카드가 되는 걸 막는다 */}
      {shownPluginToDelete && (
        <PluginDataDeleteModal
          isOpen={dataDeleteModalOpen}
          onClose={() => {
            setDataDeleteModalOpen(false);
            setPluginToDelete(null);
          }}
          onConfirm={(withData) =>
            withData
              ? removePluginWithData(shownPluginToDelete.id)
              : removePluginOnly(shownPluginToDelete.id)
          }
          pluginName={getPluginDisplayName(shownPluginToDelete.name)}
          t={t}
        />
      )}
    </div>
  );
};

export default Settings;
