import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useUIStore } from '@stores/useUIStore';
import FolderIcon from '@assets/svgs/folder.svg';
import SettingIcon from '@assets/svgs/setting.svg';
import ChevronDownIcon from '@assets/svgs/chevron-down.svg';
import TurnIcon from '@assets/svgs/turn_arrow.svg';
import FloatingTooltip from '../Modal/tooltip/FloatingTooltip';
import ListPopup from '../Modal/listPopup/ListPopup';
import IconSwap from '../common/IconSwap';
import EyeToggleIcon from '../common/EyeToggleIcon';
import { TooltipGroup } from '../Modal/tooltip/TooltipGroup';
import { obsApi } from '@api/modules/window/obsApi';
import { overlayApi } from '@api/modules/window/overlayApi';
import { presetsApi } from '@api/modules/resources/presetsApi';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useIconMotion } from '@hooks/useIconMotion';
import IconMotion from './icons/IconMotion';

interface SettingToolProps {
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
  showAlert?: (message: string) => void;
  interactionDisabled?: boolean;
  // onOpenNoteSetting?: () => void;
}

const SettingTool = ({
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  showAlert,
  interactionDisabled = false,
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

  // 메뉴는 body 포털이므로 ToolBar의 inert 경계 밖에서 별도로 닫는다
  useEffect(() => {
    if (!interactionDisabled) return;
    setIsExportImportOpenLocal(false);
    setExportImportPopupOpen(false);
  }, [interactionDisabled, setExportImportPopupOpen]);

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
    overlayApi
      .setVisible(next)
      .catch((error) => {
        // 실패 시 낙관적 갱신 롤백 - 백엔드 상태는 무변경이므로 이전 값이 진실
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
      const result = await runPresetAction(() => presetsApi.save());
      if (!result) return;
      // success가 false면 선택창을 닫은 것 - 실패가 아니므로 알리지 않음
      if (!result.success) return;
      showAlert?.(t('preset.saveSuccess'));
    } catch (error) {
      console.error('Failed to save preset', error);
      showAlert?.(t('preset.saveFail'));
    }
  };

  const handlePresetLoad = async () => {
    try {
      const result = await runPresetAction(() => presetsApi.load());
      if (!result) return;
      if (!result.success) return;
      useGridSelectionStore.getState().clearSelection();
      showAlert?.(t('preset.loadSuccess'));
    } catch (error) {
      console.error('Failed to load preset', error);
      showAlert?.(t('preset.loadFail'));
    }
  };

  const handlePresetSaveTab = async () => {
    try {
      const result = await runPresetAction(() => presetsApi.saveTab());
      if (!result) return;
      if (!result.success) return;
      showAlert?.(t('preset.saveTabSuccess'));
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
      const result = await runPresetAction(() => presetsApi.loadTab());
      if (!result) return;
      if (!result.success) return;
      useGridSelectionStore.getState().clearSelection();
      showAlert?.(t('preset.loadTabSuccess'));
    } catch (error) {
      console.error('Failed to load tab preset', error);
      showAlert?.(resolvePresetLoadTabErrorMessage(error));
    }
  };

  return (
    <div className="flex gap-[8px]">
      {!isSettingsOpen && (
        <TooltipGroup>
          <div className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface gap-[0px]">
            <FloatingTooltip content={t('tooltip.exportPreset')}>
              <Button
                icon={
                  <IconMotion motion="tilt">
                    <FolderIcon />
                  </IconMotion>
                }
                onClick={handlePresetSave}
              />
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
        <div className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface gap-[4px]">
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
                    activeIcon={
                      <IconMotion motion="rewind">
                        <TurnIcon />
                      </IconMotion>
                    }
                    inactiveIcon={
                      <IconMotion motion="turn">
                        <SettingIcon />
                      </IconMotion>
                    }
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
  const { motionProps } = useIconMotion();

  return (
    <button
      type="button"
      disabled={disabled}
      {...(disabled ? {} : motionProps)}
      className={`flex items-center justify-center h-[30px] w-[30px] rounded-md transition-colors duration-fast ${
        disabled
          ? 'opacity-40 cursor-not-allowed text-fg-muted'
          : `active:bg-fill-hover ${
              isSelected
                ? 'bg-fill-hover text-fg'
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
    const { motionProps } = useIconMotion();

    return (
      <button
        ref={ref}
        type="button"
        className={`flex items-center justify-center h-[30px] w-[14px] rounded-md transition-colors duration-fast active:bg-fill-hover ${
          isSelected
            ? 'bg-fill-hover text-fg'
            : 'text-fg-muted hover:bg-fill hover:text-fg'
        }`}
        onClick={onClick}
        {...motionProps}
      >
        <IconMotion motion="nod">
          <ChevronDownIcon />
        </IconMotion>
      </button>
    );
  },
);

export default SettingTool;
