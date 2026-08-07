import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useUIStore } from '@stores/useUIStore';
import FolderIcon from '@assets/svgs/folder.svg';
import SettingIcon from '@assets/svgs/setting.svg';
import ChevronDownIcon from '@assets/svgs/chevron-down.svg';
import TurnIcon from '@assets/svgs/turn_arrow.svg';
import FloatingTooltip from '../Modal/FloatingTooltip';
import ListPopup from '../Modal/ListPopup';
import IconSwap from '../common/IconSwap';
import EyeToggleIcon from '../common/EyeToggleIcon';
import { TooltipGroup } from '../Modal/TooltipGroup';
import { obsApi } from '@api/modules/obsApi';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

interface SettingToolProps {
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
  showAlert?: (message: string) => void;
  // onOpenNoteSetting?: () => void;
}

const SettingTool = ({
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  showAlert,
}: // onOpenNoteSetting,
SettingToolProps) => {
  const { t } = useTranslation();
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [isObsModeActive, setIsObsModeActive] = useState(false);
  const [isExportImportOpenLocal, setIsExportImportOpenLocal] = useState(false);
  // const [isExtrasOpen, setIsExtrasOpenLocal] = useState(false);
  const exportImportRef = useRef<HTMLButtonElement | null>(null);
  const overlayTogglingRef = useRef(false);
  const presetActionRef = useRef(false);
  // const extrasRef = useRef<HTMLButtonElement | null>(null);
  // const { noteEffect } = useSettingsStore();
  // const setExtrasPopupOpen = useUIStore((state) => state.setExtrasPopupOpen);
  const setExportImportPopupOpen = useUIStore(
    (state) => state.setExportImportPopupOpen,
  );

  // isExportImportOpen 상태를 설정하면서 전역 스토어에도 동기화
  const setIsExportImportOpen = (
    value: boolean | ((prev: boolean) => boolean),
  ) => {
    setIsExportImportOpenLocal((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      setExportImportPopupOpen(newValue);
      return newValue;
    });
  };

  // 로컬 상태를 읽을 때는 isExportImportOpenLocal 사용
  const isExportImportOpen = isExportImportOpenLocal;

  // isExtrasOpen 상태를 설정하면서 전역 스토어에도 동기화
  // const setIsExtrasOpen = (value: boolean | ((prev: boolean) => boolean)) => {
  //   setIsExtrasOpenLocal((prev) => {
  //     const newValue = typeof value === "function" ? value(prev) : value;
  //     setExtrasPopupOpen(newValue);
  //     return newValue;
  //   });
  // };

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    window.api.overlay
      .get()
      .then((state) => {
        setIsOverlayVisible(state.visible);
      })
      .catch((error) => {
        console.error('Failed to fetch overlay visibility', error);
      });

    unsubscribe = window.api.overlay.onVisibility(({ visible }) => {
      setIsOverlayVisible(visible);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // OBS 모드 상태 구독
  useEffect(() => {
    obsApi
      .status()
      .then((status) => setIsObsModeActive(status.running))
      .catch(() => undefined);

    const unsubscribeObs = obsApi.onStatus((status) => {
      setIsObsModeActive(status.running);
    });

    return () => unsubscribeObs();
  }, []);

  // const menuItems: ListItem[] = [
  //   { id: "note", label: t("tooltip.noteSettings"), disabled: !noteEffect },
  // ];

  const toggleOverlay = () => {
    if (overlayTogglingRef.current) return;
    overlayTogglingRef.current = true;
    const next = !isOverlayVisible;
    setIsOverlayVisible(next);
    window.api.overlay
      .setVisible(next)
      .catch((error) => {
        // 실패 시 낙관적 갱신 롤백 — 백엔드 상태는 무변경이므로 이전 값이 진실
        setIsOverlayVisible(!next);
        console.error('Failed to toggle overlay', error);
      })
      .finally(() => {
        overlayTogglingRef.current = false;
      });
  };

  const runPresetAction = async <T,>(action: () => Promise<T>) => {
    if (presetActionRef.current) return null;
    presetActionRef.current = true;
    try {
      return await action();
    } finally {
      presetActionRef.current = false;
    }
  };

  const handlePresetSave = async () => {
    try {
      const result = await runPresetAction(() => window.api.presets.save());
      if (!result) return;
      showAlert?.(
        result?.success ? t('preset.saveSuccess') : t('preset.saveFail'),
      );
    } catch (error) {
      console.error('Failed to save preset', error);
      showAlert?.(t('preset.saveFail'));
    }
  };

  const handlePresetLoad = async () => {
    try {
      const result = await runPresetAction(() => window.api.presets.load());
      if (!result) return;
      if (result?.success) {
        useGridSelectionStore.getState().clearSelection();
      }
      showAlert?.(
        result?.success ? t('preset.loadSuccess') : t('preset.loadFail'),
      );
    } catch (error) {
      console.error('Failed to load preset', error);
      showAlert?.(t('preset.loadFail'));
    }
  };

  const handlePresetSaveTab = async () => {
    try {
      const result = await runPresetAction(() => window.api.presets.saveTab());
      if (!result) return;
      showAlert?.(
        result?.success ? t('preset.saveTabSuccess') : t('preset.saveTabFail'),
      );
    } catch (error) {
      console.error('Failed to save tab preset', error);
      showAlert?.(t('preset.saveTabFail'));
    }
  };

  const resolvePresetLoadTabErrorMessage = (error: unknown): string => {
    let code = '';
    if (typeof error === 'string') {
      code = error;
    } else if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        code = message;
      }
    }

    if (code.includes('tab-preset-ambiguous-source')) {
      return t('preset.loadTabAmbiguousSource');
    }
    if (
      code.includes('invalid-tab-preset') ||
      code.includes('invalid-preset')
    ) {
      // 백엔드가 담아준 원인 필드 경로 노출 (예: keyPositions["4key"][1].…)
      const detail = code.split('invalid-preset:')[1]?.trim();
      const base = t('preset.loadTabInvalidPreset');
      return detail ? `${base} (${detail})` : base;
    }
    return t('preset.loadTabFail');
  };

  const handlePresetLoadTab = async () => {
    try {
      const result = await runPresetAction(() => window.api.presets.loadTab());
      if (!result) return;
      if (result?.success) {
        useGridSelectionStore.getState().clearSelection();
      }
      showAlert?.(
        result?.success ? t('preset.loadTabSuccess') : t('preset.loadTabFail'),
      );
    } catch (error) {
      console.error('Failed to load tab preset', error);
      showAlert?.(resolvePresetLoadTabErrorMessage(error));
    }
  };

  return (
    <div className="flex gap-[8px]">
      {!isSettingsOpen && (
        <TooltipGroup>
          <div className="flex items-center h-[40px] p-[5px] bg-fill rounded-surface gap-[0px]">
            <FloatingTooltip content={t('tooltip.exportPreset')}>
              <Button icon={<FolderIcon />} onClick={handlePresetSave} />
            </FloatingTooltip>

            <FloatingTooltip
              content={t('tooltip.importExport')}
              disabled={isExportImportOpen}
            >
              <ChevronButton
                ref={exportImportRef}
                isSelected={isExportImportOpen}
                onClick={() => setIsExportImportOpen((prev) => !prev)}
              />
            </FloatingTooltip>
            <div className="relative">
              <ListPopup
                open={isExportImportOpen}
                ariaLabel={t('common.more')}
                referenceRef={exportImportRef}
                onClose={() => setIsExportImportOpen(false)}
                items={[
                  {
                    id: 'import',
                    label: t('preset.import'),
                    children: [
                      { id: 'import-all', label: t('preset.importAll') },
                      { id: 'import-tab', label: t('preset.importTab') },
                    ],
                  },
                  {
                    id: 'export',
                    label: t('preset.export'),
                    children: [
                      { id: 'export-all', label: t('preset.exportAll') },
                      { id: 'export-tab', label: t('preset.exportTab') },
                    ],
                  },
                ]}
                onSelect={async (id) => {
                  if (id === 'import-all') {
                    await handlePresetLoad();
                  } else if (id === 'import-tab') {
                    await handlePresetLoadTab();
                  } else if (id === 'export-all') {
                    await handlePresetSave();
                  } else if (id === 'export-tab') {
                    await handlePresetSaveTab();
                  }
                  setIsExportImportOpen(false);
                }}
              />
            </div>
          </div>
        </TooltipGroup>
      )}
      <TooltipGroup>
        <div className="flex items-center h-[40px] p-[5px] bg-fill rounded-surface gap-[4px]">
          <FloatingTooltip
            content={
              isObsModeActive
                ? t('tooltip.overlayObsDisabled')
                : isOverlayVisible
                ? t('tooltip.overlayClose')
                : t('tooltip.overlayOpen')
            }
          >
            <Button
              icon={<EyeToggleIcon slashed={isOverlayVisible} />}
              onClick={isObsModeActive ? undefined : toggleOverlay}
              disabled={isObsModeActive}
            />
          </FloatingTooltip>
          <div className="flex items-center">
            <FloatingTooltip
              content={
                isSettingsOpen ? t('tooltip.back') : t('tooltip.settings')
              }
            >
              <Button
                icon={
                  <IconSwap
                    active={isSettingsOpen}
                    activeIcon={<TurnIcon />}
                    inactiveIcon={<SettingIcon />}
                  />
                }
                onClick={isSettingsOpen ? onCloseSettings : onOpenSettings}
              />
            </FloatingTooltip>
            {/* 기타 설정 extras 영역 주석처리 */}
            {/*
            <>
              <FloatingTooltip
                content={t("tooltip.etcSettings")}
                disabled={isExtrasOpen}
              >
                <ChevronButton
                  ref={extrasRef}
                  isSelected={isExtrasOpen}
                  onClick={() => setIsExtrasOpen((prev) => !prev)}
                />
              </FloatingTooltip>
              <div className="relative">
                <ListPopup
                  open={isExtrasOpen}
                  ariaLabel={t('common.more')}
                  referenceRef={extrasRef}
                  onClose={() => setIsExtrasOpen(false)}
                  items={menuItems}
                  onSelect={(id) => {
                    if (id === "note") {
                      onOpenNoteSetting?.();
                    }
                  }}
                  offsetX={-10}
                />
              </div>
            </>
            */}
          </div>
        </div>
      </TooltipGroup>
    </div>
  );
};

interface ButtonProps {
  icon: React.ReactNode;
  isSelected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const Button = ({
  icon,
  isSelected = false,
  disabled = false,
  onClick,
}: ButtonProps) => {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex items-center justify-center h-[30px] w-[30px] rounded-md transition-colors duration-fast ${
        disabled
          ? 'opacity-40 cursor-not-allowed text-fg-muted'
          : `active:bg-fill-hover ${
              isSelected
                ? 'bg-surface-active text-fg'
                : 'text-fg-muted hover:bg-fill hover:text-fg'
            }`
      }`}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
    </button>
  );
};

interface ChevronButtonProps {
  isSelected?: boolean;
  onClick?: () => void;
}

const ChevronButton = React.forwardRef<HTMLButtonElement, ChevronButtonProps>(
  ({ isSelected = false, onClick }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`flex items-center justify-center h-[30px] w-[14px] rounded-md transition-colors duration-fast active:bg-fill-hover ${
          isSelected
            ? 'bg-surface-active text-fg'
            : 'text-fg-muted hover:bg-fill hover:text-fg'
        }`}
        onClick={onClick}
      >
        <ChevronDownIcon />
      </button>
    );
  },
);

export default SettingTool;
