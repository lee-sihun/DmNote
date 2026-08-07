import React, { useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  updateInfo: UpdateInfo;
  onClose: () => void;
  onSkipVersion: () => void;
  isLatestVersion?: boolean;
  onPrimaryAction?: () => Promise<void> | void;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
}

const UpdateModal = ({
  isOpen,
  updateInfo,
  onClose,
  onSkipVersion,
  isLatestVersion = false,
  onPrimaryAction,
  primaryActionLabel,
  primaryActionDisabled = false,
}: UpdateModalProps) => {
  const { t } = useTranslation();
  const [skipChecked, setSkipChecked] = useState(false);
  const { run: runPrimaryAction, pending: primaryActionPending } =
    useSingleFlightAction(async () => {
      if (primaryActionDisabled) return;
      try {
        if (onPrimaryAction) {
          await onPrimaryAction();
          return;
        }
        await window.api.app.openExternal(updateInfo.releaseUrl);
      } catch (error) {
        console.error('Failed to run update primary action:', error);
      }
    });

  // 모달 열릴 때 체크박스 상태 리셋
  React.useEffect(() => {
    if (isOpen) {
      setSkipChecked(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGoToRelease = async () => {
    try {
      await window.api.app.openExternal(updateInfo.releaseUrl);
    } catch (e) {
      console.error('Failed to open release URL:', e);
    }
  };

  const handleClose = () => {
    if (skipChecked) {
      onSkipVersion();
    } else {
      onClose();
    }
  };

  // 파싱 실패·빈 값은 캡션 자체를 생략
  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString();
  };

  const publishedLabel = formatDate(updateInfo.publishedAt);

  return (
    <Modal
      onClick={handleClose}
      ariaLabel={t('update.title')}
      contentMountStrategy="after-paint"
    >
      <div
        className="flex flex-col w-[300px] p-[14px] gap-[12px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        {isLatestVersion ? (
          // 최신 버전일 때 UI
          <>
            <h2 className="text-fg text-title">{t('update.latestAlready')}</h2>

            {/* 버전 웰, 설정 화면 버전 행과 같은 문법 */}
            <div className="flex justify-between items-center gap-[10px] p-[10px] bg-inset rounded-md">
              <span className="text-fg-muted text-body tabular-nums">
                Ver {updateInfo.currentVersion}
              </span>
              <button
                onClick={handleGoToRelease}
                className="shrink-0 inline-flex items-center h-[23px] px-[10px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-md text-fg text-body transition-colors duration-fast"
              >
                {t('update.releasePage')}
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-full h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
            >
              {t('common.confirm')}
            </button>
          </>
        ) : (
          // 업데이트 있을 때 UI
          <>
            <div className="flex flex-col gap-[2px]">
              <h2 className="text-fg text-title">{t('update.title')}</h2>
              {publishedLabel && (
                <p className="text-fg-faint text-caption tabular-nums">
                  {publishedLabel}
                </p>
              )}
            </div>

            {/* 버전 비교 웰, 새 버전만 fg로 올려 대비 */}
            <div className="p-[10px] bg-inset rounded-md">
              <div className="flex justify-between items-center gap-[10px]">
                <span className="text-fg-muted text-body">
                  {t('update.currentVersion')}
                </span>
                <span className="text-fg-muted text-body tabular-nums">
                  {updateInfo.currentVersion}
                </span>
              </div>
              <div className="flex justify-between items-center gap-[10px] mt-[8px]">
                <span className="text-fg-muted text-body">
                  {t('update.latestVersion')}
                </span>
                <span className="text-fg text-body tabular-nums">
                  {updateInfo.latestVersion}
                </span>
              </div>
            </div>

            {/* 이 버전 건너뛰기 체크박스 */}
            <label className="flex items-center gap-[8px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipChecked}
                onChange={(e) => setSkipChecked(e.target.checked)}
                className="w-[14px] h-[14px] rounded-[3px] border border-line-strong bg-inset
                           checked:bg-accent checked:border-accent cursor-pointer
                           appearance-none relative
                           after:content-[''] after:absolute after:hidden
                           after:left-[4px] after:top-[1px] after:w-[4px] after:h-[8px]
                           after:border-r-[2px] after:border-b-[2px] after:border-accent-fg
                           after:rotate-45 checked:after:block"
              />
              <span className="text-fg-muted text-caption">
                {t('update.skipVersion')}
              </span>
            </label>

            {/* 버튼들 */}
            <div className="flex gap-[8px]">
              <button
                onClick={() => void runPrimaryAction()}
                disabled={primaryActionDisabled || primaryActionPending}
                className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {primaryActionLabel || t('update.goToRelease')}
              </button>
              <button
                onClick={handleClose}
                className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
              >
                {t('update.later')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default UpdateModal;
