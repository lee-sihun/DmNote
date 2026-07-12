/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState, useRef } from 'react';
import Modal from '../../Modal';
import Checkbox from '@components/main/common/Checkbox';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import { useTranslation } from '@contexts/useTranslation';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { TabCss } from '@src/types/plugin/css';

interface TabCssModalProps {
  isOpen: boolean;
  onClose: () => void;
  showAlert?: (message: string, confirmText?: string) => void;
}

const TabCssModal = ({ isOpen, onClose, showAlert }: TabCssModalProps) => {
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
    <Modal onClick={handleCancel} ariaLabel={t('tabCss.enableCss')}>
      <div
        className="flex flex-col min-w-[264px] p-[14px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 gap-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* CSS 설정 카드 */}
        <PropertySection>
          <PropertyRow label={t('tabCss.enableCss')}>
            <Checkbox checked={cssEnabled} onChange={handleToggleCss} />
          </PropertyRow>
          <PropertyRow label={t('tabCss.cssFile')}>
            <button
              type="button"
              onClick={handleClearCss}
              disabled={isLoading || !hasTabCss}
              className={`px-[8px] h-[23px] rounded-md transition-colors duration-fast flex items-center justify-center text-body ${
                hasTabCss
                  ? 'bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active text-danger-fg'
                  : 'bg-fill-faint text-fg-disabled cursor-not-allowed'
              }`}
            >
              {t('tabCss.remove')}
            </button>
            <button
              type="button"
              onClick={handleLoadCss}
              disabled={isLoading}
              className="px-[7px] h-[23px] bg-fill rounded-md flex items-center justify-center text-fg text-body hover:bg-fill-hover active:bg-fill-active"
            >
              {t('tabCss.loadFile')}
            </button>
          </PropertyRow>
        </PropertySection>

        {/* 버튼 영역 */}
        <div className="flex gap-[8px]">
          <button
            onClick={handleSave}
            className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
          >
            {t('keySetting.save')}
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
          >
            {t('keySetting.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default TabCssModal;
