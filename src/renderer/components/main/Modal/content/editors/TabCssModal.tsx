/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState, useRef } from 'react';
import Modal from '../../Modal';
import Checkbox from '@components/main/common/Checkbox';
import { useTranslation } from '@contexts/I18nContext';
import { useKeyStore } from '@stores/useKeyStore';
import type { TabCss } from '@src/types/css';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  showAlert?: (message: string, confirmText?: string) => void;
};

export default function TabCssModal({ isOpen, onClose, showAlert }: Props) {
  const { t } = useTranslation();
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  const [tabCss, setTabCss] = useState<TabCss | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 모달 열기 시점의 원본 상태 저장 (취소 시 복원용)
  const originalStateRef = useRef<TabCss | null>(null);

  // 모달이 열릴 때 현재 탭의 CSS 정보 로드 및 원본 상태 저장
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    window.api.css.tab
      .get(selectedKeyType)
      .then((tabResponse) => {
        const css = tabResponse.css || null;
        setTabCss(css);
        // 원본 상태 깊은 복사로 저장
        originalStateRef.current = css ? { ...css } : null;
      })
      .catch((error) => {
        console.error('Failed to get CSS info:', error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen, selectedKeyType]);

  // 탭 CSS 변경 이벤트 구독 (실시간 미리보기 반영)
  useEffect(() => {
    if (!isOpen) return;

    const unsubTabCss = window.api.css.tab.onChanged((payload) => {
      if (payload.tabId === selectedKeyType) {
        setTabCss(payload.css || null);
      }
    });

    return () => {
      unsubTabCss();
    };
  }, [isOpen, selectedKeyType]);

  const handleLoadCss = async () => {
    try {
      const result = await window.api.css.tab.load(selectedKeyType);
      if (result.success && result.css) {
        setTabCss(result.css);
      } else if (result.error) {
        showAlert?.(t('tabCss.loadFailed') + ': ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load tab CSS:', error);
    }
  };

  const handleClearCss = async () => {
    try {
      const result = await window.api.css.tab.clear(selectedKeyType);
      if (result.success) {
        setTabCss(null);
      }
    } catch (error) {
      console.error('Failed to clear tab CSS:', error);
    }
  };

  const handleToggleCss = async () => {
    const newEnabled = !(tabCss?.enabled ?? true);
    try {
      const result = await window.api.css.tab.toggle(
        selectedKeyType,
        newEnabled,
      );
      if (result.success) {
        setTabCss((prev) =>
          prev
            ? { ...prev, enabled: result.enabled }
            : { path: null, content: '', enabled: result.enabled },
        );
      }
    } catch (error) {
      console.error('Failed to toggle tab CSS:', error);
    }
  };

  // 저장: 현재 상태 유지하고 모달 닫기
  const handleSave = () => {
    onClose();
  };

  // 취소: 원본 상태로 복원하고 모달 닫기
  const handleCancel = async () => {
    const original = originalStateRef.current;

    try {
      // 원본 상태와 현재 상태가 다른 경우에만 복원
      const currentState = tabCss;
      const statesAreDifferent =
        original?.path !== currentState?.path ||
        original?.content !== currentState?.content ||
        original?.enabled !== currentState?.enabled;

      if (statesAreDifferent) {
        // css.tab.set을 사용하여 원본 상태로 직접 복원
        await window.api.css.tab.set(selectedKeyType, original);
      }
    } catch (error) {
      console.error('Failed to restore original state:', error);
    }

    onClose();
  };

  if (!isOpen) return null;

  const hasTabCss = tabCss && tabCss.path;
  const cssEnabled = tabCss?.enabled ?? true;

  return (
    <Modal onClick={handleCancel}>
      <div
        className="flex flex-col items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] gap-[19px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* CSS 사용 여부 토글 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('tabCss.enableCss')}</p>
          <Checkbox checked={cssEnabled} onChange={handleToggleCss} />
        </div>

        {/* CSS 파일 */}
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t('tabCss.cssFile')}</p>
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={handleClearCss}
              disabled={isLoading || !hasTabCss}
              className={`px-[7px] h-[23px] rounded-[7px] border-[1px] flex items-center justify-center text-style-4 ${
                hasTabCss
                  ? 'bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] border-[#4A2A2A] text-[#E6DBDB]'
                  : 'bg-[#2A2A30] border-[#3A3943] text-[#6B6D77] cursor-not-allowed'
              }`}
            >
              {t('tabCss.remove')}
            </button>
            <button
              type="button"
              onClick={handleLoadCss}
              disabled={isLoading}
              className="px-[7px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] flex items-center justify-center text-[#DBDEE8] text-style-4 hover:bg-[#303036] active:bg-[#393941]"
            >
              {t('tabCss.loadFile')}
            </button>
          </div>
        </div>

        {/* 버튼 영역 */}
        <div className="flex gap-[10.5px]">
          <button
            onClick={handleSave}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t('keySetting.save')}
          </button>
          <button
            onClick={handleCancel}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            {t('keySetting.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
