import React, { useEffect, useRef, useState } from 'react';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';
import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';
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
import {
  FILL_DISABLED_CLASS,
  FILL_INTERACTIVE_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { applyCounterSnapshot } from '@stores/signals/keyCounterSignals';
import {
  currentPluginHealthRevision,
  waitForPluginInjection,
} from '@stores/plugin/usePluginHealthStore';
import {
  extractPluginId,
  getPluginDisplayName,
} from '@utils/plugin/pluginUtils';
import { classifyPluginAddResult } from '@utils/plugin/pluginAddResult';
import { isMac } from '@utils/core/platform';
import { useUpdateCheck } from '@hooks/app/useUpdateCheck';
import type { OverlayResizeAnchor } from '@src/types/settings/settings';
import type { ShortcutsState } from '@src/types/settings/shortcuts';
import type { SupportedLocale } from '@contexts/I18nContextDef';
import type {
  JsLoadResult,
  JsReloadResult,
  JsRemoveResult,
  JsPluginUpdateResult,
  KeysResetAllResponse,
} from '@src/types/plugin/api';
import type { JsPlugin } from '@src/types/plugin/js';
import type { KeyCounters } from '@src/types/key/keys';
import { settingsApi } from '@api/modules/settingsApi';
import { overlayApi } from '@api/modules/overlayApi';
import { cssApi } from '@api/modules/cssApi';
import { jsApi } from '@api/modules/jsApi';
import { pluginApi } from '@api/modules/pluginApi';
import { keysApi } from '@api/modules/keysApi';
import { appApi, windowApi } from '@api/modules/appApi';
import { obsApi } from '@api/modules/obsApi';
import { keySoundOutputApi } from '@api/modules/resourceApi';
import type {
  KeySoundOutputBackend,
  KeySoundOutputDevices,
  KeySoundOutputState,
} from '@api/modules/resourceApi';
import type { ObsStatus } from '@src/types/obs';
import { DEFAULT_OBS_PORT } from '@src/types/obs';
import { assertCanonicalEditorDocument } from '@src/types/editor';

// ASIO 버퍼 크기 선택지(프레임). 게임 설정값과 맞춰야 ASIO 공존 가능.
const ASIO_BUFFER_SIZES = [64, 128, 256, 512, 1024] as const;
// 기본 버퍼 크기 (게임 기본값과 동일한 최저값)
const DEFAULT_ASIO_BUFFER = 64;

// 설정 패널은 열 때마다 재마운트되므로, 마지막 출력 상태를 모듈에 캐시해
// 재진입 시 '기본 장치 → 선택 장치' 드롭다운 깜빡임을 방지한다.
let cachedKeySoundOutput: KeySoundOutputState | null = null;
// null이면 목록 미로딩
let cachedOutputDevices: KeySoundOutputDevices | null = null;

const KEY_SOUND_DEVICE_PREFIX = 'device:';
const KEY_SOUND_ASIO_PREFIX = 'asio:';

// 드롭다운 라벨용 축약
const truncateDeviceName = (name: string) =>
  name.length > 16 ? `${name.slice(0, 16)}…` : name;

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

interface PluginError {
  path?: string;
  error: string;
}

interface PluginToDelete {
  id: string;
  name: string;
  namespace: string;
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
  const regeneratingObsTokenRef = useRef(false);
  const angleModeChangeRef = useRef(false);
  const pendingResizeAnchorRef = useRef<OverlayResizeAnchor | null>(null);
  const applyingResizeAnchorRef = useRef(false);
  const confirmedResizeAnchorRef = useRef(overlayResizeAnchor);

  // OBS 모드
  const [obsStatus, setObsStatus] = useState<ObsStatus>({
    running: false,
    port: DEFAULT_OBS_PORT,
    clientCount: 0,
  });
  const obsTogglingRef = useRef(false);

  // 키음 출력 백엔드 (기본 장치 / 시스템 장치 / ASIO) — 캐시로 초기화해 재진입 깜빡임 방지
  const [keySoundOutput, setKeySoundOutputRaw] =
    useState<KeySoundOutputState | null>(cachedKeySoundOutput);
  // 목록 로딩 완료(null 아님) 전에는 드롭다운을 잠그지 않음 (첫 마운트 비활성 깜빡임 방지)
  const [outputDevices, setOutputDevices] =
    useState<KeySoundOutputDevices | null>(cachedOutputDevices);
  const pendingKeySoundOutputRef = useRef<KeySoundOutputBackend | null>(null);
  const applyingKeySoundOutputRef = useRef(false);

  const setKeySoundOutput = (state: KeySoundOutputState) => {
    cachedKeySoundOutput = state;
    setKeySoundOutputRaw(state);
  };

  useEffect(() => {
    if (!applyingResizeAnchorRef.current) {
      confirmedResizeAnchorRef.current = overlayResizeAnchor;
    }
  }, [overlayResizeAnchor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [devices, state] = await Promise.all([
          keySoundOutputApi.listDevices(),
          keySoundOutputApi.getState(),
        ]);
        if (cancelled) return;
        cachedOutputDevices = devices;
        setOutputDevices(devices);
        if (
          !applyingKeySoundOutputRef.current &&
          !pendingKeySoundOutputRef.current
        ) {
          setKeySoundOutput(state);
        }
      } catch (error) {
        console.error('Failed to load key sound output state', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enqueueKeySoundOutput = (backend: KeySoundOutputBackend) => {
    pendingKeySoundOutputRef.current = backend;
    setKeySoundOutputRaw((current) => {
      if (!current) return current;
      const optimistic = {
        ...current,
        requested: backend,
        error: null,
        errorCode: null,
      };
      cachedKeySoundOutput = optimistic;
      return optimistic;
    });
    if (applyingKeySoundOutputRef.current) return;

    applyingKeySoundOutputRef.current = true;
    void (async () => {
      while (pendingKeySoundOutputRef.current) {
        const requested = pendingKeySoundOutputRef.current;
        pendingKeySoundOutputRef.current = null;
        try {
          const result = await keySoundOutputApi.setBackend(requested);
          if (!pendingKeySoundOutputRef.current) setKeySoundOutput(result);
        } catch (error) {
          console.error('Failed to set key sound output backend', error);
          showAlert(t('common.saveFailed'));
          if (!pendingKeySoundOutputRef.current) {
            try {
              const authoritative = await keySoundOutputApi.getState();
              if (!pendingKeySoundOutputRef.current) {
                setKeySoundOutput(authoritative);
              }
            } catch (syncError) {
              console.error('Failed to resync key sound output', syncError);
            }
          }
        }
      }
      applyingKeySoundOutputRef.current = false;
    })();
  };

  const handleKeySoundOutputChange = (val: string) => {
    if (val.startsWith(KEY_SOUND_ASIO_PREFIX)) {
      enqueueKeySoundOutput({
        kind: 'asio',
        driverName: val.slice(KEY_SOUND_ASIO_PREFIX.length),
        // ASIO 선택 시 기본 버퍼 64 (게임과 동일하게 맞춰야 공존 가능)
        bufferSize: DEFAULT_ASIO_BUFFER,
      });
      return;
    }
    if (val.startsWith(KEY_SOUND_DEVICE_PREFIX)) {
      const id = val.slice(KEY_SOUND_DEVICE_PREFIX.length);
      const requested = keySoundOutput?.requested;
      // 목록에 없는 장치는 저장된(분리된) 선택 항목뿐
      const name =
        outputDevices?.system.find((item) => item.id === id)?.name ??
        (requested?.kind === 'device' && requested.id === id
          ? requested.name
          : null);
      if (name === null) return;
      enqueueKeySoundOutput({ kind: 'device', id, name });
      return;
    }
    enqueueKeySoundOutput({ kind: 'defaultDevice' });
  };

  // ASIO 버퍼 크기 변경 (게임과 동일 버퍼로 맞춰야 ASIO 공존 가능)
  const handleAsioBufferChange = (val: string) => {
    const requested = keySoundOutput?.requested;
    if (requested?.kind !== 'asio') return;
    enqueueKeySoundOutput({
      kind: 'asio',
      driverName: requested.driverName,
      bufferSize: Number(val),
    });
  };

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

  // OBS 상태 이벤트 구독 + clientCount 폴링
  useEffect(() => {
    let mounted = true;
    obsApi
      .status()
      .then((status) => {
        if (mounted) setObsStatus(status);
      })
      .catch(() => undefined);

    // start/stop 이벤트 구독
    const unsubscribe = obsApi.onStatus((status) => {
      if (mounted) setObsStatus(status);
    });

    // clientCount는 connect/disconnect 이벤트가 없으므로 폴링 유지
    const interval = setInterval(async () => {
      try {
        const status = await obsApi.status();
        if (mounted) {
          setObsStatus((prev) =>
            prev.clientCount === status.clientCount ? prev : status,
          );
        }
      } catch {}
    }, 5000);

    return () => {
      mounted = false;
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

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

  const formatPluginErrors = (errors: PluginError[] = []): string =>
    errors.map((item) => `${item.path ?? 'unknown'}: ${item.error}`).join('\n');

  // 파일을 읽는 데 성공해도 브라우저가 평가하지 못하면 실패다.
  // 주입 결과가 정산될 때까지 기다렸다가 실제로 죽은 플러그인을 오류로 합류시킨다
  const collectInjectionErrors = async (
    candidates: JsPlugin[],
    revision: number,
  ): Promise<PluginError[]> => {
    const injected: JsPlugin[] = candidates.filter(
      (plugin) => plugin.enabled && plugin.content,
    );
    if (!injected.length) return [];

    const { outcome, health } = await waitForPluginInjection(
      revision,
      injected.map((plugin) => plugin.id),
    );

    // 전역 JS가 꺼져 있으면 주입 대상이 아니다. 실패로 셀 일이 아니다
    if (outcome === 'skipped') return [];

    // 주입이 아예 못 돌았으면 결과가 비어 있다. 이걸 '오류 없음'으로 읽으면
    // 실행되지 않은 플러그인을 성공으로 표시하게 된다
    if (outcome !== 'settled') {
      return injected.map((plugin) => ({
        path: plugin.path ?? plugin.name,
        error: t('settings.jsNotApplied'),
      }));
    }

    return injected
      .filter((plugin) => health[plugin.id]?.status === 'failed')
      .map((plugin) => ({
        path: plugin.path ?? plugin.name,
        // 빈 메시지(throw '')는 nullish가 아니라 그대로 렌더되므로 ||
        error: health[plugin.id]?.message || t('settings.jsRuntimeError'),
      }));
  };

  const canReloadPlugins: boolean = jsPlugins.some(
    (plugin: JsPlugin) => plugin.path,
  );

  const handleReloadPlugins = async (): Promise<void> => {
    if (reloadingPluginsRef.current) return;
    if (jsPlugins.length === 0) {
      showAlert?.(t('settings.jsReloadNoPlugins'));
      return;
    }
    const startTime: number = performance.now();
    reloadingPluginsRef.current = true;
    setIsReloadingPlugins(true);
    try {
      // 요청 전에 회차를 잡는다 - 응답보다 주입 정산이 먼저 끝나도 놓치지 않는다
      const healthRevision: number = currentPluginHealthRevision();
      const result: JsReloadResult = await jsApi.reload();
      const updated: JsPlugin[] = result.updated ?? [];
      const injectionErrors: PluginError[] = await collectInjectionErrors(
        updated,
        healthRevision,
      );
      const errors: PluginError[] = [
        ...(result.errors ?? []),
        ...injectionErrors,
      ];

      const succeeded: number = updated.length - injectionErrors.length;

      if (errors.length && succeeded) {
        showAlert?.(
          `${t('settings.jsReloadPartial', {
            count: succeeded,
          })}\n${formatPluginErrors(errors)}`,
        );
      } else if (errors.length) {
        showAlert?.(
          `${t('settings.jsReloadFailed')}\n${formatPluginErrors(errors)}`,
        );
      } else if (succeeded) {
        showAlert?.(t('settings.jsReloadSuccess', { count: succeeded }));
      } else {
        showAlert?.(t('settings.jsReloadNoChanges'));
      }
    } catch (error) {
      console.error('Failed to reload JS plugins', error);
      showAlert?.(`${t('settings.jsReloadFailed')}${error}`);
    } finally {
      reloadingPluginsRef.current = false;
      const elapsed: number = performance.now() - startTime;
      const MIN_SPINNER_MS = 250;
      if (elapsed < MIN_SPINNER_MS) {
        setTimeout(
          () => setIsReloadingPlugins(false),
          MIN_SPINNER_MS - elapsed,
        );
      } else {
        setIsReloadingPlugins(false);
      }
    }
  };

  const handleAddPlugins = async (): Promise<void> => {
    if (addingPluginsRef.current) return;
    addingPluginsRef.current = true;
    setIsAddingPlugins(true);
    try {
      const healthRevision: number = currentPluginHealthRevision();
      const result: JsLoadResult = await jsApi.load();
      if (!result) return;
      const added: JsPlugin[] = result.added ?? [];
      const injectionErrors: PluginError[] = await collectInjectionErrors(
        added,
        healthRevision,
      );
      const errors: PluginError[] = [
        ...(result.errors ?? []),
        ...injectionErrors,
      ];
      const alertKind = classifyPluginAddResult(added.length, errors.length);

      if (alertKind === 'partial') {
        showAlert?.(
          `${t('settings.jsAddPartial', {
            count: added.length,
          })}\n${formatPluginErrors(errors)}`,
        );
      } else if (alertKind === 'failed') {
        showAlert?.(
          `${t('settings.jsAddFailed')}\n${formatPluginErrors(errors)}`,
        );
      } else if (alertKind === 'success') {
        showAlert?.(t('settings.jsAddSuccess', { count: added.length }));
      }
    } catch (error) {
      console.error('Failed to add JS plugins', error);
      showAlert?.(`${t('settings.jsAddFailed')}${error}`);
    } finally {
      addingPluginsRef.current = false;
      setIsAddingPlugins(false);
    }
  };

  const handlePluginToggle = async (
    pluginId: string,
    nextState: boolean,
  ): Promise<void> => {
    if (pendingPluginRef.current) return;
    pendingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);
    try {
      const result: JsPluginUpdateResult = await jsApi.setPluginEnabled(
        pluginId,
        nextState,
      );
      if (!result.success) {
        showAlert?.(t('settings.jsPluginToggleFailed'));
      }
    } catch (error) {
      console.error('Failed to toggle JS plugin', error);
      showAlert?.(t('settings.jsPluginToggleFailed'));
    } finally {
      pendingPluginRef.current = null;
      setPendingPluginId(null);
    }
  };

  const handlePluginRemove = async (pluginId: string): Promise<void> => {
    const plugin: JsPlugin | undefined = jsPlugins.find(
      (candidate: JsPlugin) => candidate.id === pluginId,
    );
    if (!plugin) return;
    if (removingPluginRef.current || pendingPluginRef.current) return;
    removingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);

    try {
      await trackEditorWrite(
        (async () => {
          // 실제 플러그인 네임스페이스 추출 (@id 또는 파일명 기반)
          const pluginNamespace: string = extractPluginId(
            plugin.content,
            plugin.name,
          );
          const pluginStorageNamespace = `${pluginNamespace}/`;

          // 네임스페이스를 prefix로 사용하는 데이터가 있는지 확인
          // 백엔드에서 자동으로 "plugin_data_" 를 붙이므로 순수 네임스페이스만 전달
          const hasData: boolean = await pluginApi.storage.hasData(
            pluginStorageNamespace,
          );
          console.warn(
            '[PluginRemove] namespace=',
            pluginNamespace,
            'hasData=',
            hasData,
          );

          if (hasData) {
            setPluginToDelete({
              id: pluginId,
              name: plugin.name,
              namespace: pluginNamespace,
            });
            setDataDeleteModalOpen(true);
          } else {
            removingPluginRef.current = null;
            setPendingPluginId(null);
            await removePluginOnly(pluginId);
          }
        })(),
      );
    } catch (error) {
      console.error('Failed to check plugin data', error);
      showAlert?.(t('settings.jsPluginRemoveFailed'));
    } finally {
      removingPluginRef.current = null;
      setPendingPluginId(null);
    }
  };

  const removePluginOnly = async (pluginId: string): Promise<void> => {
    if (removingPluginRef.current) return;
    removingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);
    try {
      const result: JsRemoveResult = await jsApi.remove(pluginId);
      if (!result.success) {
        showAlert?.(t('settings.jsPluginRemoveFailed'));
      }
    } catch (error) {
      console.error('Failed to remove JS plugin', error);
      showAlert?.(t('settings.jsPluginRemoveFailed'));
    } finally {
      removingPluginRef.current = null;
      setPendingPluginId(null);
      setDataDeleteModalOpen(false);
      setPluginToDelete(null);
    }
  };

  const removePluginWithData = async (pluginId: string): Promise<void> => {
    if (removingPluginRef.current) return;
    removingPluginRef.current = pluginId;
    setPendingPluginId(pluginId);
    try {
      const plugin: JsPlugin | undefined = jsPlugins.find(
        (p: JsPlugin) => p.id === pluginId,
      );
      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // 실제 네임스페이스를 다시 추출
      const pluginNamespace: string = extractPluginId(
        plugin.content,
        plugin.name,
      );
      const pluginStorageNamespace = `${pluginNamespace}/`;

      // 1) 먼저 플러그인 제거 → 클린업이 실행되며 일부 플러그인은 저장을 시도할 수 있음
      const result: JsRemoveResult = await jsApi.remove(pluginId);
      if (!result.success) {
        showAlert?.(t('settings.jsPluginRemoveFailed'));
        return;
      }

      // 2) 그 다음 스토리지 정리 → 클린업 중 재생성된 값까지 함께 제거
      await pluginApi.storage.clearByPrefix(pluginStorageNamespace);
    } catch (error) {
      console.error('Failed to remove JS plugin with data', error);
      showAlert?.(t('settings.jsPluginRemoveFailed'));
    } finally {
      removingPluginRef.current = null;
      setPendingPluginId(null);
      setDataDeleteModalOpen(false);
      setPluginToDelete(null);
    }
  };

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

  const enqueueResizeAnchor = (anchor: OverlayResizeAnchor): void => {
    pendingResizeAnchorRef.current = anchor;
    setOverlayResizeAnchor(anchor);
    if (applyingResizeAnchorRef.current) return;

    applyingResizeAnchorRef.current = true;
    void (async () => {
      while (pendingResizeAnchorRef.current) {
        const requested = pendingResizeAnchorRef.current;
        pendingResizeAnchorRef.current = null;
        try {
          await overlayApi.setAnchor(requested);
          confirmedResizeAnchorRef.current = requested;
        } catch (error) {
          console.error('Failed to set overlay anchor', error);
          showAlert(t('common.saveFailed'));
          if (!pendingResizeAnchorRef.current) {
            setOverlayResizeAnchor(confirmedResizeAnchorRef.current);
          }
        }
      }
      applyingResizeAnchorRef.current = false;
    })();
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

  const handleObsToggle = async (): Promise<void> => {
    if (obsTogglingRef.current) return;
    const next = !obsStatus.running;
    setObsStatus((prev) => ({ ...prev, running: next }));
    obsTogglingRef.current = true;
    let commandCompleted = false;
    try {
      await trackEditorWrite(
        (async () => {
          const status = next ? await obsApi.start() : await obsApi.stop();
          commandCompleted = true;
          setObsStatus(status);
          await settingsApi.update({ obsModeEnabled: next });
        })(),
      );
    } catch (error) {
      console.error('Failed to toggle OBS mode', error);
      if (!commandCompleted) {
        setObsStatus((prev) => ({ ...prev, running: !next }));
      }
      showAlert?.(
        commandCompleted
          ? t('common.saveFailed')
          : next
          ? t('settings.obsStartFailed')
          : t('settings.obsStopFailed'),
      );
    } finally {
      obsTogglingRef.current = false;
    }
  };

  const handleObsCopyUrl = async (): Promise<void> => {
    const tokenParam = obsStatus.token ? `?token=${obsStatus.token}` : '';
    const host = obsStatus.localIp || 'localhost';
    const url = `http://${host}:${obsStatus.port}${tokenParam}`;
    try {
      await navigator.clipboard.writeText(url);
      showAlert?.(t('settings.obsCopied'));
    } catch {
      showAlert?.(url);
    }
  };

  const handleObsRegenerateToken = (): void => {
    if (regeneratingObsTokenRef.current) return;
    regeneratingObsTokenRef.current = true;
    showConfirm(
      t('settings.obsTokenRegenMessage'),
      async () => {
        try {
          const status = await obsApi.regenerateToken();
          setObsStatus(status);
        } catch (error) {
          console.error('Failed to regenerate OBS token', error);
          showAlert(t('common.actionFailed'));
        } finally {
          regeneratingObsTokenRef.current = false;
        }
      },
      {
        confirmText: t('settings.obsTokenRegenConfirm'),
        onCancel: () => {
          regeneratingObsTokenRef.current = false;
        },
      },
    );
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
            customTabs: result.customTabs,
            selectedKeyType: result.selectedKeyType,
          });
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

  const requestedBackend = keySoundOutput?.requested;
  const requestedAsioDriver =
    requestedBackend?.kind === 'asio' ? requestedBackend.driverName : null;
  const asioDrivers = outputDevices?.asio ?? [];
  const visibleAsioDrivers =
    requestedAsioDriver && !asioDrivers.includes(requestedAsioDriver)
      ? [...asioDrivers, requestedAsioDriver]
      : asioDrivers;
  // 저장된 장치가 현재 목록에 없어도(분리됨) 선택 상태가 보이도록 병합
  const requestedDevice =
    requestedBackend?.kind === 'device' ? requestedBackend : null;
  const systemDevices = outputDevices?.system ?? [];
  const visibleSystemDevices =
    requestedDevice && !systemDevices.some((d) => d.id === requestedDevice.id)
      ? [
          ...systemDevices,
          { id: requestedDevice.id, name: requestedDevice.name },
        ]
      : systemDevices;
  // 같은 이름 장치는 순번으로 구분, 순번은 축약 밖에 붙여 항상 보이게
  const systemDeviceLabels = new Map<string, string>();
  const nameCounts = new Map<string, number>();
  for (const device of visibleSystemDevices) {
    const seen = (nameCounts.get(device.name) ?? 0) + 1;
    nameCounts.set(device.name, seen);
    const base = truncateDeviceName(device.name);
    systemDeviceLabels.set(device.id, seen > 1 ? `${base} (${seen})` : base);
  }
  const keySoundOutputValue =
    requestedBackend?.kind === 'asio'
      ? `${KEY_SOUND_ASIO_PREFIX}${requestedBackend.driverName}`
      : requestedBackend?.kind === 'device'
      ? `${KEY_SOUND_DEVICE_PREFIX}${requestedBackend.id}`
      : 'defaultDevice';
  const requestedAsioBuffer =
    keySoundOutput?.requested.kind === 'asio'
      ? keySoundOutput.requested.bufferSize || DEFAULT_ASIO_BUFFER
      : DEFAULT_ASIO_BUFFER;
  const visibleAsioBuffers = ASIO_BUFFER_SIZES.some(
    (size) => size === requestedAsioBuffer,
  )
    ? ASIO_BUFFER_SIZES
    : [...ASIO_BUFFER_SIZES, requestedAsioBuffer].sort((a, b) => a - b);

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
            <SettingCard>
              <SettingRow
                label={
                  <p className="text-label text-fg flex-1 min-w-0 truncate pr-[10px]">
                    {t('settings.keySoundOutput') || '키 사운드 출력'}
                  </p>
                }
                onMouseEnter={() => hoverPreview('keySoundOutput')}
                onMouseLeave={() => hoverPreview(null)}
              >
                <Dropdown
                  options={[
                    {
                      value: 'defaultDevice',
                      label:
                        t('settings.keySoundOutputDefault') || '기본 재생 장치',
                    },
                    // 이름이 길면 …로 축약 (기본 항목 라벨은 안 잘리게 max-w 여유)
                    // 장치를 못 열면 백엔드가 선택을 기본 장치로 되돌리므로 경고 라벨 없음
                    ...visibleSystemDevices.map((device) => ({
                      value: `${KEY_SOUND_DEVICE_PREFIX}${device.id}`,
                      label:
                        systemDeviceLabels.get(device.id) ??
                        truncateDeviceName(device.name),
                    })),
                    ...visibleAsioDrivers.map((name) => ({
                      value: `${KEY_SOUND_ASIO_PREFIX}${name}`,
                      label: `ASIO: ${truncateDeviceName(name)}`,
                    })),
                  ]}
                  value={keySoundOutputValue}
                  onChange={handleKeySoundOutputChange}
                  placeholder={
                    t('settings.keySoundOutputDefault') || '기본 재생 장치'
                  }
                  align="right"
                  widthClass="max-w-[160px]"
                  disabled={
                    outputDevices !== null &&
                    visibleSystemDevices.length + visibleAsioDrivers.length ===
                      0
                  }
                />
              </SettingRow>
              <SettingRow
                label={
                  <p
                    className={`text-label ${
                      keySoundOutput?.requested.kind === 'asio'
                        ? 'text-fg'
                        : 'text-fg-disabled'
                    }`}
                  >
                    {t('settings.keySoundOutputBuffer') || 'ASIO 버퍼 크기'}
                  </p>
                }
              >
                <Dropdown
                  options={visibleAsioBuffers.map((size) => ({
                    value: String(size),
                    label: String(size),
                  }))}
                  value={String(requestedAsioBuffer)}
                  onChange={handleAsioBufferChange}
                  placeholder={String(DEFAULT_ASIO_BUFFER)}
                  align="right"
                  disabled={keySoundOutput?.requested.kind !== 'asio'}
                />
              </SettingRow>
            </SettingCard>
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
