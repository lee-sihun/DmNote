import React, { useEffect, useMemo, useState } from "react";
import { useLenis } from "@hooks/useLenis";
import { useTranslation } from "@contexts/I18nContext";
import { useSettingsStore } from "@stores/useSettingsStore";
import { useKeyStore } from "@stores/useKeyStore";
import Checkbox from "@components/main/common/Checkbox";
import Dropdown from "@components/main/common/Dropdown";
import FlaskIcon from "@assets/svgs/flask.svg";
import { PluginManagerModal } from "@components/main/Modal/content/PluginManagerModal";
import { PluginDataDeleteModal } from "@components/main/Modal/content/PluginDataDeleteModal";
import ShortcutSettingsModal from "@components/main/Modal/content/ShortcutSettingsModal";
import { applyCounterSnapshot } from "@stores/keyCounterSignals";
import { extractPluginId } from "@utils/pluginUtils";
import { isMac } from "@utils/platform";
import { useUpdateCheck } from "@hooks/useUpdateCheck";

// 설정 미리보기 영상
const PREVIEW_SOURCES = {
  overlayLock:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/overlay-lock.webm",
  alwaysOnTop:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/alwaysontop.webm",
  noteEffect:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/noteeffect.webm",
  keyCounter:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/counter.webm",
  customCSS:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/css.webm",
  customJS:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/plugin.webm",
  resizeAnchor:
    "https://raw.githubusercontent.com/lee-sihun/DmNote/master/docs/assets/webm/resize.webm",
};

export default function Settings({ showAlert, showConfirm }) {
  const { t, i18n } = useTranslation();
  const isMacOS = isMac();
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
    laboratoryEnabled,
    setLaboratoryEnabled,
    trayEnabled,
    setTrayEnabled,
    developerModeEnabled,
    setDeveloperModeEnabled,
    useCustomCSS,
    setUseCustomCSS,
    setCustomCSSContent,
    customCSSPath,
    setCustomCSSPath,
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

  const [hoveredKey, setHoveredKey] = useState(null);
  const [isScrollHovered, setIsScrollHovered] = useState(false);
  const [isPluginModalOpen, setPluginModalOpen] = useState(false);
  const [isDataDeleteModalOpen, setDataDeleteModalOpen] = useState(false);
  const [isShortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [pluginToDelete, setPluginToDelete] = useState(null);
  const [isReloadingPlugins, setIsReloadingPlugins] = useState(false);
  const [isAddingPlugins, setIsAddingPlugins] = useState(false);
  const [pendingPluginId, setPendingPluginId] = useState(null);

  // Lenis smooth scroll 적용 (전역 설정 사용)
  const { scrollContainerRef } = useLenis();

  const RESIZE_ANCHOR_OPTIONS = [
    { value: "top-left", key: "topLeft" },
    { value: "bottom-left", key: "bottomLeft" },
    { value: "top-right", key: "topRight" },
    { value: "bottom-right", key: "bottomRight" },
    { value: "center", key: "center" },
    // 미완성 기능
    // { value: "fixed-position", key: "fixedPosition" },
  ];

  const ANGLE_OPTIONS = [
    { value: "skia", label: "Skia" },
    { value: "d3d11", label: "Direct3D 11" },
    { value: "d3d9", label: "Direct3D 9" },
    { value: "gl", label: "OpenGL" },
  ];

  const macAngleOptions = useMemo(
    () => [{ value: "metal", label: "Metal" }],
    [],
  );

  useEffect(() => {
    if (isMacOS && angleMode !== "metal") {
      setAngleMode("metal");
    }
  }, [isMacOS, angleMode, setAngleMode]);

  const LANGUAGE_OPTIONS = [
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
    { value: "zh-cn", label: "简体中文" },
    { value: "zh-Hant", label: "繁體中文" },
    { value: "ru", label: "Русский" },
  ];

  const handleHardwareAccelerationChange = () => {
    const next = !hardwareAcceleration;

    const apply = async () => {
      setHardwareAcceleration(next);
      try {
        await window.api.settings.update({ hardwareAcceleration: next });
        await window.api.app.restart();
      } catch (error) {
        console.error("Failed to toggle hardware acceleration", error);
      }
    };

    if (showConfirm) {
      showConfirm(t("settings.restartConfirm"), apply);
    } else {
      apply();
    }
  };

  const handleAlwaysOnTopChange = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      await window.api.settings.update({ alwaysOnTop: next });
    } catch (error) {
      console.error("Failed to toggle always-on-top", error);
    }
  };

  const handleOverlayLockChange = async () => {
    const next = !overlayLocked;
    setOverlayLocked(next);
    try {
      await window.api.overlay.setLock(next);
    } catch (error) {
      console.error("Failed to toggle overlay lock", error);
    }
  };

  const handleToggleCustomCSS = async () => {
    const next = !useCustomCSS;
    setUseCustomCSS(next);
    try {
      await window.api.css.toggle(next);
    } catch (error) {
      console.error("Failed to toggle custom CSS", error);
    }
  };

  const handleLoadCustomCSS = async () => {
    if (!useCustomCSS) return;
    try {
      const result = await window.api.css.load();
      if (result?.success) {
        if (result.content) setCustomCSSContent(result.content);
        if (result.path) setCustomCSSPath(result.path);
        showAlert?.(t("settings.cssLoaded"));
      } else {
        const message = result?.error
          ? `${t("settings.cssLoadFailed")}${result.error}`
          : t("settings.cssLoadFailed");
        showAlert?.(message);
      }
    } catch (error) {
      console.error("Failed to load custom CSS", error);
      showAlert?.(`${t("settings.cssLoadFailed")}${error}`);
    }
  };

  const handleToggleCustomJS = async () => {
    const next = !useCustomJS;
    setUseCustomJS(next);
    try {
      await window.api.js.toggle(next);
    } catch (error) {
      console.error("Failed to toggle custom JS", error);
    }
  };

  const formatPluginErrors = (errors = []) =>
    errors.map((item) => `${item.path ?? "unknown"}: ${item.error}`).join("\n");

  const canReloadPlugins = jsPlugins.some((plugin) => plugin.path);

  const handleReloadPlugins = async () => {
    if (isReloadingPlugins) return;
    if (jsPlugins.length === 0) {
      showAlert?.(t("settings.jsReloadNoPlugins"));
      return;
    }
    const startTime = performance.now();
    setIsReloadingPlugins(true);
    try {
      const result = await window.api.js.reload();
      const updated = result?.updated ?? [];
      const errors = result?.errors ?? [];

      if (errors.length && updated.length) {
        showAlert?.(
          `${t("settings.jsReloadPartial", {
            count: updated.length,
          })}\n${formatPluginErrors(errors)}`,
        );
      } else if (errors.length) {
        showAlert?.(
          `${t("settings.jsReloadFailed")}\n${formatPluginErrors(errors)}`,
        );
      } else if (updated.length) {
        showAlert?.(t("settings.jsReloadSuccess", { count: updated.length }));
      } else {
        showAlert?.(t("settings.jsReloadNoChanges"));
      }
    } catch (error) {
      console.error("Failed to reload JS plugins", error);
      showAlert?.(`${t("settings.jsReloadFailed")}${error}`);
    } finally {
      const elapsed = performance.now() - startTime;
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

  const handleOpenPluginModal = () => {
    setPluginModalOpen(true);
  };

  const handleClosePluginModal = () => {
    setPluginModalOpen(false);
  };

  const handleAddPlugins = async () => {
    if (isAddingPlugins) return;
    setIsAddingPlugins(true);
    try {
      const result = await window.api.js.load();
      if (!result) return;
      const added = result.added ?? [];
      const errors = result.errors ?? [];

      if (errors.length && added.length) {
        showAlert?.(
          `${t("settings.jsAddPartial", {
            count: added.length,
          })}\n${formatPluginErrors(errors)}`,
        );
      } else if (errors.length) {
        showAlert?.(
          `${t("settings.jsAddFailed")}\n${formatPluginErrors(errors)}`,
        );
      } else if (added.length) {
        showAlert?.(t("settings.jsAddSuccess", { count: added.length }));
      }
    } catch (error) {
      console.error("Failed to add JS plugins", error);
      showAlert?.(`${t("settings.jsAddFailed")}${error}`);
    } finally {
      setIsAddingPlugins(false);
    }
  };

  const handlePluginToggle = async (pluginId, nextState) => {
    if (pendingPluginId) return;
    setPendingPluginId(pluginId);
    try {
      const result = await window.api.js.setPluginEnabled(pluginId, nextState);
      if (!result?.success) {
        showAlert?.(t("settings.jsPluginToggleFailed"));
      }
    } catch (error) {
      console.error("Failed to toggle JS plugin", error);
      showAlert?.(t("settings.jsPluginToggleFailed"));
    } finally {
      setPendingPluginId(null);
    }
  };

  const handlePluginRemove = async (pluginId) => {
    if (pendingPluginId) return;

    const plugin = jsPlugins.find((p) => p.id === pluginId);
    if (!plugin) return;

    try {
      // 실제 플러그인 네임스페이스 추출 (@id 또는 파일명 기반)
      const pluginNamespace = extractPluginId(plugin.content, plugin.name);

      // 네임스페이스를 prefix로 사용하는 데이터가 있는지 확인
      // 백엔드에서 자동으로 "plugin_data_" 를 붙이므로 순수 네임스페이스만 전달
      const hasData = await window.api.plugin.storage.hasData(pluginNamespace);
      console.debug(
        "[PluginRemove] namespace=",
        pluginNamespace,
        "hasData=",
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
        await removePluginOnly(pluginId);
      }
    } catch (error) {
      console.error("Failed to check plugin data", error);
      showAlert?.(t("settings.jsPluginRemoveFailed"));
    }
  };

  const removePluginOnly = async (pluginId) => {
    setPendingPluginId(pluginId);
    try {
      const result = await window.api.js.remove(pluginId);
      if (!result?.success) {
        showAlert?.(t("settings.jsPluginRemoveFailed"));
      }
    } catch (error) {
      console.error("Failed to remove JS plugin", error);
      showAlert?.(t("settings.jsPluginRemoveFailed"));
    } finally {
      setPendingPluginId(null);
      setDataDeleteModalOpen(false);
      setPluginToDelete(null);
    }
  };

  const removePluginWithData = async (pluginId) => {
    setPendingPluginId(pluginId);
    try {
      const plugin = jsPlugins.find((p) => p.id === pluginId);
      if (!plugin) {
        throw new Error("Plugin not found");
      }

      // 실제 네임스페이스를 다시 추출
      const pluginNamespace = extractPluginId(plugin.content, plugin.name);

      // 1) 먼저 플러그인 제거 → 클린업이 실행되며 일부 플러그인은 저장을 시도할 수 있음
      const result = await window.api.js.remove(pluginId);
      if (!result?.success) {
        showAlert?.(t("settings.jsPluginRemoveFailed"));
      }

      // 2) 그 다음 스토리지 정리 → 클린업 중 재생성된 값까지 함께 제거
      await window.api.plugin.storage.clearByPrefix(pluginNamespace);
    } catch (error) {
      console.error("Failed to remove JS plugin with data", error);
      showAlert?.(t("settings.jsPluginRemoveFailed"));
    } finally {
      setPendingPluginId(null);
      setDataDeleteModalOpen(false);
      setPluginToDelete(null);
    }
  };

  const actionButtonClass = (enabled) =>
    "py-[4px] px-[8px] border-[1px] rounded-[7px] text-style-2 transition-colors " +
    (enabled
      ? "bg-[#2A2A31] border-[#3A3944] text-[#DBDEE8] hover:bg-[#34343c]"
      : "bg-[#222228] border-[#31303C] text-[#44464E] cursor-not-allowed");

  const handleNoteEffectChange = async () => {
    const next = !noteEffect;
    setNoteEffect(next);
    try {
      await window.api.settings.update({ noteEffect: next });
    } catch (error) {
      console.error("Failed to toggle note effect", error);
    }
  };

  const handleSaveShortcuts = async (next) => {
    setShortcuts(next);
    try {
      await window.api.settings.update({ shortcuts: next });
    } catch (error) {
      console.error("Failed to update shortcuts", error);
      showAlert?.(t("shortcutSetting.saveFailed"));
    }
  };

  const handleAngleModeChangeSelect = (val) => {
    if (isMacOS) return;
    const apply = async () => {
      setAngleMode(val);
      try {
        await window.api.settings.update({ angleMode: val });
        await window.api.app.restart();
      } catch (error) {
        console.error("Failed to change angle mode", error);
      }
    };

    if (showConfirm) {
      showConfirm(t("settings.restartConfirm"), apply);
    } else {
      apply();
    }
  };

  const handleLaboratoryToggle = async () => {
    const next = !laboratoryEnabled;
    setLaboratoryEnabled(next);
    try {
      await window.api.settings.update({ laboratoryEnabled: next });
    } catch (error) {
      console.error("Failed to toggle laboratory mode", error);
    }
  };

  const handleTrayToggle = async () => {
    const next = !trayEnabled;
    setTrayEnabled(next);
    try {
      await window.api.settings.update({ trayEnabled: next });
    } catch (error) {
      console.error("Failed to toggle tray mode", error);
    }
  };

  const handleDeveloperModeToggle = async () => {
    const next = !developerModeEnabled;
    setDeveloperModeEnabled(next);
    try {
      await window.api.settings.update({ developerModeEnabled: next });
      // 개발자 모드가 활성화되면 즉시 DevTools 오픈 (메인 & 오버레이)
      if (next) {
        try {
          await window.api.window.openDevtoolsAll?.();
        } catch (e) {}
      }
    } catch (error) {
      console.error("Failed to toggle developer mode", error);
    }
  };

  const handleKeyCounterToggle = async () => {
    const next = !keyCounterEnabled;
    setKeyCounterEnabled(next);
    try {
      await window.api.settings.update({ keyCounterEnabled: next });
    } catch (error) {
      console.error("Failed to toggle key counter", error);
    }
  };

  const handleResetCounters = async (event) => {
    event.stopPropagation();
    try {
      const snapshot = await window.api.keys.resetCounters();
      applyCounterSnapshot(snapshot);
      showAlert?.(t("settings.counterReset"));
    } catch (error) {
      console.error("Failed to reset key counters", error);
      showAlert?.(t("settings.counterResetFailed"));
    }
  };

  const handleResetAll = () => {
    const reset = async () => {
      try {
        const result = await window.api.keys.resetAll();
        if (result) {
          // 리셋 직후 메모리 상태도 바로 초기값으로 변경
          useKeyStore.setState({
            keyMappings: result.keys,
            positions: result.positions,
            customTabs: result.customTabs,
            selectedKeyType: result.selectedKeyType,
          });
        }
      } catch (error) {
        console.error("Failed to reset presets", error);
      }
    };

    if (showConfirm) {
      showConfirm(
        t("settings.resetAllConfirm"),
        reset,
        t("settings.initialize"),
      );
    } else {
      reset();
    }
  };

  const handleLanguageChange = (val) => {
    setLanguage(val);
    i18n.changeLanguage(val);
  };

  return (
    <div className="relative w-full h-full">
      <div
        ref={scrollContainerRef}
        className={`settings-content-scroll w-full h-full flex flex-col py-[10px] px-[10px] gap-[19px] overflow-y-auto bg-[#0B0B0D] ${
          isScrollHovered ? "show-scrollbar" : ""
        }`}
        onMouseEnter={() => setIsScrollHovered(true)}
        onMouseLeave={() => setIsScrollHovered(false)}
      >
        {/* 설정 */}
        <div className="flex flex-row gap-[19px]">
          <div className="flex flex-col gap-[10px] w-[348px]">
            {/* 키뷰어 설정 */}
            <div className="flex flex-col p-[19px] py-[7px] bg-primary rounded-[7px] gap-[0px]">
              <div
                className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                onMouseEnter={() => setHoveredKey("overlayLock")}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={handleOverlayLockChange}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.overlayLock")}
                </p>
                <Checkbox
                  checked={overlayLocked}
                  onChange={handleOverlayLockChange}
                />
              </div>
              <div
                className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                onMouseEnter={() => setHoveredKey("alwaysOnTop")}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={handleAlwaysOnTopChange}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.alwaysOnTop")}
                </p>
                <Checkbox
                  checked={alwaysOnTop}
                  onChange={handleAlwaysOnTopChange}
                />
              </div>
              <div
                className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                onMouseEnter={() => setHoveredKey("noteEffect")}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={handleNoteEffectChange}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.noteEffect")}
                </p>
                <Checkbox
                  checked={noteEffect}
                  onChange={handleNoteEffectChange}
                />
              </div>
              <div
                className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                onMouseEnter={() => setHoveredKey("keyCounter")}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={handleKeyCounterToggle}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.keyCounter")}
                </p>
                <div className="flex items-center gap-[8px]">
                  {/* <button
                    onClick={handleResetCounters}
                    className="py-[4px] px-[8px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] text-style-2 text-[#DBDEE8] hover:bg-[#34343c]"
                  >
                    {t("settings.counterResetButton")}
                  </button> */}
                  <Checkbox
                    checked={keyCounterEnabled}
                    onChange={handleKeyCounterToggle}
                  />
                </div>
              </div>
              {/*
              <div
                className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                onMouseEnter={() => setHoveredKey("laboratory")}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={handleLaboratoryToggle}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.laboratory")}
                </p>
                <Checkbox
                  checked={laboratoryEnabled}
                  onChange={handleLaboratoryToggle}
                />
              </div>
              */}
              <div
                className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                onClick={handleTrayToggle}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.trayEnabled")}
                </p>
                <Checkbox checked={trayEnabled} onChange={handleTrayToggle} />
              </div>
              {null}
              <div
                className="flex flex-row justify-between items-center h-[40px]"
                onMouseEnter={() => setHoveredKey("resizeAnchor")}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.resizeAnchor")}
                </p>
                <Dropdown
                  options={RESIZE_ANCHOR_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: t(`settings.${opt.key}`),
                  }))}
                  value={overlayResizeAnchor}
                  onChange={async (val) => {
                    setOverlayResizeAnchor(val);
                    try {
                      await window.api.overlay.setAnchor(val);
                    } catch (error) {
                      console.error("Failed to set overlay anchor", error);
                    }
                  }}
                  placeholder={t("settings.selectAnchor")}
                />
              </div>
            </div>
            {/* 커스텀 CSS & JS 설정 */}
            <div className="flex flex-col p-[19px] py-[7px] bg-primary rounded-[7px] gap-[0px]">
              <div
                className="flex flex-col gap-[0px]"
                onMouseEnter={() => setHoveredKey("customCSS")}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <div
                  className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                  onClick={handleToggleCustomCSS}
                >
                  <p className="text-style-3 text-[#FFFFFF]">
                    {t("settings.customCSS")}
                  </p>
                  <Checkbox
                    checked={useCustomCSS}
                    onChange={handleToggleCustomCSS}
                  />
                </div>
                <div className="flex flex-row justify-between items-center h-[40px]">
                  <p
                    className={
                      "text-[12px] truncate max-w-[150px] " +
                      (useCustomCSS ? "text-[#989BA6]" : "text-[#44464E]")
                    }
                  >
                    {customCSSPath && customCSSPath.length > 0
                      ? customCSSPath
                      : t("settings.noCssFile")}
                  </p>
                  <button
                    onClick={handleLoadCustomCSS}
                    disabled={!useCustomCSS}
                    className={
                      "py-[4px] px-[8px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] text-style-2 " +
                      (useCustomCSS
                        ? "text-[#DBDEE8]"
                        : "text-[#44464E] cursor-not-allowed bg-[#222228] border-[#31303C]")
                    }
                  >
                    {t("settings.loadCss")}
                  </button>
                </div>
              </div>
              <div
                className="flex flex-col gap-[0px]"
                onMouseEnter={() => setHoveredKey("customJS")}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <div
                  className="flex flex-row justify-between items-center h-[40px] cursor-pointer"
                  onClick={handleToggleCustomJS}
                >
                  <p className="text-style-3 text-[#FFFFFF]">
                    {t("settings.customJS")}
                  </p>
                  <Checkbox
                    checked={useCustomJS}
                    onChange={handleToggleCustomJS}
                  />
                </div>
                <div className="flex flex-row justify-between items-center h-[40px]">
                  <p
                    className={
                      "text-[12px] truncate max-w-[150px] " +
                      (useCustomJS ? "text-[#989BA6]" : "text-[#44464E]")
                    }
                  >
                    {t("settings.pluginManageLabel")}
                  </p>
                  <div className="flex flex-row gap-[8px]">
                    <button
                      onClick={handleReloadPlugins}
                      disabled={!canReloadPlugins || isReloadingPlugins}
                      className={
                        actionButtonClass(
                          canReloadPlugins && !isReloadingPlugins,
                        ) + " transition-none"
                      }
                      style={
                        isReloadingPlugins
                          ? { opacity: 0.65, pointerEvents: "none" }
                          : undefined
                      }
                    >
                      {t("settings.reloadPlugins")}
                    </button>
                    <button
                      onClick={handleOpenPluginModal}
                      className={actionButtonClass(true)}
                    >
                      {t("settings.managePlugins")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {/* 기타 설정 */}
            <div className="flex flex-col p-[19px] bg-primary rounded-[7px] gap-[24px]">
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.language")}
                </p>
                <Dropdown
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={handleLanguageChange}
                  placeholder={t("settings.selectLanguage")}
                />
              </div>
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.shortcuts")}
                </p>
                <button
                  onClick={() => setShortcutModalOpen(true)}
                  className={actionButtonClass(true)}
                >
                  {t("settings.configure")}
                </button>
              </div>
              <div className="flex flex-row justify-between items-center">
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.graphicsOption")}
                </p>
                <Dropdown
                  options={isMacOS ? macAngleOptions : ANGLE_OPTIONS}
                  value={isMacOS ? "metal" : angleMode}
                  onChange={handleAngleModeChangeSelect}
                  placeholder={t("settings.renderMode")}
                  disabled={isMacOS}
                />
              </div>
              <div
                className="flex flex-row justify-between items-center h-[25px] cursor-pointer"
                onClick={handleDeveloperModeToggle}
              >
                <p className="text-style-3 text-[#FFFFFF]">
                  {t("settings.developerMode")}
                </p>
                <Checkbox
                  checked={developerModeEnabled}
                  onChange={handleDeveloperModeToggle}
                />
              </div>
              {/* 버전 및 설정 초기화 */}
              <div className="flex justify-between items-center py-[14px] px-[12px] bg-[#101013] rounded-[7px]">
                <p className="text-style-3 text-[#FFFFFF]">
                  Ver {__APP_VERSION__}
                </p>
                <div className="flex gap-[8px]">
                  <button
                    className="bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] py-[4px] px-[9px] text-style-2 text-[#DCDEE7] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => checkForUpdates(true)}
                    disabled={isChecking}
                  >
                    {isChecking
                      ? t("update.checking")
                      : t("update.checkUpdate")}
                  </button>
                  <button
                    className="bg-[#401C1D] rounded-[7px] py-[4px] px-[9px] text-style-2 text-[#E8DBDB]"
                    onClick={handleResetAll}
                  >
                    {t("settings.resetData")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute flex items-center justify-center top-[10px] right-[10px] w-[522px] h-[376px] bg-primary rounded-[7px] pointer-events-none overflow-hidden">
        {hoveredKey && PREVIEW_SOURCES[hoveredKey] ? (
          <div className="relative w-full h-full">
            <video
              key={hoveredKey}
              src={PREVIEW_SOURCES[hoveredKey]}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 flex justify-center items-end h-[100px] bg-gradient-to-t from-black to-transparent pointer-events-none">
              <span className="mb-[15px] text-white text-[15px] font-medium">
                {t(`settings.${hoveredKey}Desc`)}
              </span>
            </div>
          </div>
        ) : (
          <FlaskIcon />
        )}
      </div>
      {isPluginModalOpen && (
        <PluginManagerModal
          isOpen={isPluginModalOpen}
          onClose={handleClosePluginModal}
          onAdd={handleAddPlugins}
          onToggle={handlePluginToggle}
          onRemove={handlePluginRemove}
          plugins={jsPlugins}
          isAdding={isAddingPlugins}
          pendingPluginId={pendingPluginId}
          t={t}
        />
      )}
      {isDataDeleteModalOpen && pluginToDelete && (
        <PluginDataDeleteModal
          isOpen={isDataDeleteModalOpen}
          onClose={() => {
            setDataDeleteModalOpen(false);
            setPluginToDelete(null);
          }}
          onDeleteWithData={() => removePluginWithData(pluginToDelete.id)}
          onDeletePluginOnly={() => removePluginOnly(pluginToDelete.id)}
          pluginName={pluginToDelete.name}
          t={t}
        />
      )}
      {isShortcutModalOpen && (
        <ShortcutSettingsModal
          isOpen={isShortcutModalOpen}
          shortcuts={shortcuts}
          onClose={() => setShortcutModalOpen(false)}
          onSave={handleSaveShortcuts}
        />
      )}
    </div>
  );
}
