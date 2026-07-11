import React, { useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';

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

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const handlePrimaryClick = async () => {
    if (primaryActionDisabled) return;
    if (onPrimaryAction) {
      await onPrimaryAction();
      return;
    }
    await handleGoToRelease();
  };

  return (
    <Modal onClick={handleClose}>
      <div
        className="flex flex-col bg-glass-heavy backdrop-blur-[32px] rounded-modal shadow-elevation-3 p-[20px] min-w-[320px] max-w-[400px]"
        onClick={(e) => e.stopPropagation()}
      >
        {isLatestVersion ? (
          // 최신 버전일 때 UI
          <>
            {/* 헤더 */}
            <div className="flex items-center gap-[10px] mb-[16px]">
              <div className="w-[32px] h-[32px] rounded-full bg-success-muted flex items-center justify-center">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <h2 className="text-fg text-label font-medium">
                  {t('update.latestAlready')}
                </h2>
              </div>
            </div>

            {/* 버전 정보 */}
            <div className="bg-inset rounded-[8px] p-[12px] mb-[16px]">
              <div className="flex justify-between items-center">
                <span className="text-fg-muted text-body">
                  {t('update.currentVersion')}
                </span>
                <span className="text-success text-body font-mono font-medium">
                  {updateInfo.currentVersion}
                </span>
              </div>
            </div>

            {/* 버튼 */}
            <div className="flex gap-[10px]">
              <button
                onClick={handleGoToRelease}
                className="flex-1 h-[32px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active
                           rounded-lg text-accent-fg text-body font-medium transition-colors"
              >
                {t('update.goToRelease')}
              </button>
              <button
                onClick={onClose}
                className="w-[80px] h-[32px] bg-fill hover:bg-fill-hover active:bg-fill-active
                           rounded-md text-fg text-body transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          </>
        ) : (
          // 업데이트 있을 때 UI
          <>
            {/* 헤더 */}
            <div className="flex items-center gap-[10px] mb-[16px]">
              <div className="w-[32px] h-[32px] rounded-full bg-success-muted flex items-center justify-center">
                <svg
                  width="14"
                  height="16"
                  viewBox="0 0 14 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <g clipPath="url(#clip0_972_48)">
                    <path
                      d="M11.7063 6.70625L7.70625 10.7063C7.31563 11.0969 6.68125 11.0969 6.29063 10.7063L2.29063 6.70625C1.9 6.31563 1.9 5.68125 2.29063 5.29063C2.68125 4.9 3.31562 4.9 3.70625 5.29063L6 7.58437V1C6 0.446875 6.44687 0 7 0C7.55313 0 8 0.446875 8 1V7.58437L10.2937 5.29063C10.6844 4.9 11.3188 4.9 11.7094 5.29063C12.1 5.68125 12.1 6.31563 11.7094 6.70625H11.7063ZM2 11V13C2 13.5531 2.44687 14 3 14H11C11.5531 14 12 13.5531 12 13V11C12 10.4469 12.4469 10 13 10C13.5531 10 14 10.4469 14 11V13C14 14.6562 12.6562 16 11 16H3C1.34375 16 0 14.6562 0 13V11C0 10.4469 0.446875 10 1 10C1.55313 10 2 10.4469 2 11Z"
                      fill="currentColor"
                    />
                  </g>
                  <defs>
                    <clipPath id="clip0_972_48">
                      <rect width="14" height="16" fill="white" />
                    </clipPath>
                  </defs>
                </svg>
              </div>
              <div>
                <h2 className="text-fg text-label font-medium">
                  {t('update.title')}
                </h2>
                <p className="text-fg-muted text-caption">
                  {formatDate(updateInfo.publishedAt)}
                </p>
              </div>
            </div>

            {/* 버전 정보 */}
            <div className="bg-inset rounded-[8px] p-[12px] mb-[16px]">
              <div className="flex justify-between items-center mb-[8px]">
                <span className="text-fg-muted text-body">
                  {t('update.currentVersion')}
                </span>
                <span className="text-fg text-body font-mono">
                  {updateInfo.currentVersion}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-fg-muted text-body">
                  {t('update.latestVersion')}
                </span>
                <span className="text-success text-body font-mono font-medium">
                  {updateInfo.latestVersion}
                </span>
              </div>
            </div>

            {/* 이 버전 건너뛰기 체크박스 */}
            <label className="flex items-center gap-[8px] mb-[16px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipChecked}
                onChange={(e) => setSkipChecked(e.target.checked)}
                className="w-[14px] h-[14px] rounded-[3px] border border-line-strong bg-inset
                           checked:bg-accent checked:border-accent cursor-pointer
                           appearance-none relative
                           after:content-[''] after:absolute after:hidden
                           after:left-[4px] after:top-[1px] after:w-[4px] after:h-[8px]
                           after:border-r-[2px] after:border-b-[2px] after:border-white
                           after:rotate-45 checked:after:block"
              />
              <span className="text-fg-muted text-caption">
                {t('update.skipVersion')}
              </span>
            </label>

            {/* 버튼들 */}
            <div className="flex gap-[10px]">
              <button
                onClick={handlePrimaryClick}
                disabled={primaryActionDisabled}
                className="flex-1 h-[32px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active
                           rounded-lg text-accent-fg text-body font-medium transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {primaryActionLabel || t('update.goToRelease')}
              </button>
              <button
                onClick={handleClose}
                className="w-[80px] h-[32px] bg-fill hover:bg-fill-hover active:bg-fill-active
                           rounded-md text-fg text-body transition-colors"
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
