import React, { useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import Modal from '../../Modal';
import UpdateProgressLabel from './UpdateProgressLabel';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import { appApi } from '@api/modules/appApi';
import {
  isAutoUpdateDismissLocked,
  type AutoUpdatePhase,
} from '@stores/useUpdateStore';

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
  progressPhase?: AutoUpdatePhase;
  progressPercent?: number | null;
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
  progressPhase = 'idle',
  progressPercent = null,
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
        await appApi.openExternal(updateInfo.releaseUrl);
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

  // 퇴장 모션이 도는 동안 DOM을 유지한다
  const { mounted, state: motionState } = useModalPresence(isOpen);

  if (!mounted) return null;

  const handleGoToRelease = async () => {
    try {
      await appApi.openExternal(updateInfo.releaseUrl);
    } catch (e) {
      console.error('Failed to open release URL:', e);
    }
  };

  // 다운로드부터 재시작 요청까지 중간에 멈출 방법이 없다. 모달만 닫히면
  // 재진입 가드와 재시작 실패 감시를 잃으므로 설치 완료 상태가 될 때까지 잠근다
  const updateLocked = isAutoUpdateDismissLocked(progressPhase);

  const handleClose = () => {
    if (updateLocked) return;
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

  // 크기를 모르는 다운로드는 진행률이 없다. 빈 트랙을 세워 두면 고장난 것처럼 보이므로
  // 게이지를 아예 띄우지 않고, 일하는 중이라는 신호는 셔머가 혼자 맡는다
  const gaugeShown =
    progressPhase !== 'idle' &&
    !(progressPhase === 'downloading' && progressPercent === null);
  // 다운로드가 끝난 뒤 검증·설치·재시작 구간은 채움을 100%로 붙잡는다.
  // 진행률은 백엔드가 늘려가기만 하므로 별도 역행 방지는 두지 않는다
  const gaugePercent = !gaugeShown
    ? 0
    : progressPhase === 'downloading'
    ? progressPercent ?? 0
    : 100;
  // 설치가 끝나고 재시작만 실패한 상태는 더 진행할 게 없다. 채움은 100%로 남기되
  // 셔머는 끈다, 진행이 멈췄는데 빛이 계속 흐르면 화면이 거짓말을 한다
  // 버튼은 이때 다시 열려서 재시작을 한 번 더 요청할 수 있다
  // 게이지 표시와는 별개다, 진행률을 몰라도 일은 하고 있다
  const updateWorking =
    progressPhase !== 'idle' && progressPhase !== 'installed';
  const primaryLabel = primaryActionLabel || t('update.goToRelease');

  return (
    <Modal
      motionState={motionState}
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
                aria-busy={updateWorking}
                data-busy={gaugeShown ? 'true' : 'false'}
                data-shimmer={updateWorking ? 'on' : 'off'}
                style={
                  {
                    '--dmn-gauge-p': gaugePercent,
                  } as React.CSSProperties
                }
                className="dmn-gauge flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="dmn-gauge-fill" aria-hidden="true" />
                <UpdateProgressLabel
                  phase={progressPhase}
                  text={primaryLabel}
                />
              </button>
              <button
                onClick={handleClose}
                disabled={updateLocked}
                className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-fill disabled:hover:text-fg-muted"
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
