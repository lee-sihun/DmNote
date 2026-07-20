import React, { useEffect, useState, useRef } from 'react';
import Modal from '../../Modal';
import Checkbox from '@components/main/common/Checkbox';
import {
  PropertyRow,
  PropertySection,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import {
  FILL_DISABLED_CLASS,
  FILL_INTERACTIVE_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { FORM_ROW_CLASS, FORM_LABEL_CLASS } from '@utils/cardRecipes';
import { useTranslation } from '@contexts/useTranslation';
import { useLenis } from '@hooks/useLenis';
import { useKeyStore } from '@stores/data/useKeyStore';
import { pathBaseName } from '@utils/core/pathDisplay';
import type { CustomCssHistoryItem } from '@src/types/plugin/api';
import type { TabCss } from '@src/types/plugin/css';

interface TabCssModalProps {
  isOpen: boolean;
  onClose: () => void;
  showAlert?: (message: string, confirmText?: string) => void;
}

const ACTION_BUTTON_CLASS =
  'flex-1 h-[23px] rounded-md flex items-center justify-center text-body transition-colors duration-fast';

const TabCssModal = ({ isOpen, onClose, showAlert }: TabCssModalProps) => {
  const { t } = useTranslation();
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  const [tabCss, setTabCss] = useState<TabCss | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<CustomCssHistoryItem[]>([]);
  const [pendingHistoryPath, setPendingHistoryPath] = useState<string | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);

  const { scrollContainerRef: historyScrollRef } = useLenis();

  // 모달 열기 시점의 원본 상태 저장 (취소 시 복원용)
  const originalStateRef = useRef<TabCss | null>(null);

  // 모달이 열릴 때 현재 탭의 CSS 정보와 글로벌 히스토리 로드, 원본 상태 저장
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

    window.api.css
      .historyGet()
      .then(setHistory)
      .catch((error) => {
        console.error('Failed to fetch CSS history:', error);
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

  // 글로벌 히스토리 항목을 현재 탭 CSS로 적용
  const handleApplyHistory = async (item: CustomCssHistoryItem) => {
    if (pendingHistoryPath || item.status !== 'available') return;
    if (tabCss?.path === item.path) return;
    setPendingHistoryPath(item.path);
    try {
      const result = await window.api.css.tab.activateHistory(
        selectedKeyType,
        item.path,
      );
      if (result.success && result.css) {
        setTabCss(result.css);
      } else if (!result.success) {
        showAlert?.(
          result.code
            ? t(`settings.cssHistoryError.${result.code}`)
            : t('tabCss.loadFailed'),
        );
      }
    } catch (error) {
      console.error('Failed to apply history CSS to tab:', error);
    } finally {
      setPendingHistoryPath(null);
    }
  };

  // 현재 탭 CSS 콘텐츠를 파일로 내보내기
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await window.api.css.tab.export(selectedKeyType);
      if (result.success) {
        showAlert?.(t('tabCss.exported'));
      } else if (result.code) {
        showAlert?.(
          t('tabCss.exportFailed') + (result.error ? ': ' + result.error : ''),
        );
      }
      // 저장 다이얼로그 취소(success:false, code 없음)는 무시
    } catch (error) {
      console.error('Failed to export tab CSS:', error);
      showAlert?.(t('tabCss.exportFailed'));
    } finally {
      setIsExporting(false);
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

  const hasTabCss = Boolean(tabCss && tabCss.path);
  const cssEnabled = tabCss?.enabled ?? true;
  const canExport = Boolean(tabCss?.content) && !isExporting;

  const statusLabel = (item: CustomCssHistoryItem): string | null => {
    if (item.status === 'available') return null;
    return t(`settings.cssHistoryStatus.${item.status}`);
  };

  return (
    <Modal onClick={handleCancel} ariaLabel={t('tabCss.enableCss')}>
      <div
        className="flex flex-col w-[288px] p-[14px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 gap-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상태 카드 - 토글, 적용 파일, 파일 액션 */}
        <PropertySection>
          <PropertyRow label={t('tabCss.enableCss')}>
            <Checkbox checked={cssEnabled} onChange={handleToggleCss} />
          </PropertyRow>
          <div className={FORM_ROW_CLASS}>
            <p className={`${FORM_LABEL_CLASS} shrink-0`}>
              {t('tabCss.cssFile')}
            </p>
            <span
              className="min-w-0 truncate text-body text-fg-muted"
              title={tabCss?.path ?? undefined}
            >
              {tabCss?.path
                ? pathBaseName(tabCss.path)
                : t('settings.noCssFile')}
            </span>
          </div>
          {/* 파일 액션 - 전폭 3등분으로 여백 확보 */}
          <div className="flex gap-[6px] pt-[2px] pb-[8px]">
            <button
              type="button"
              onClick={handleLoadCss}
              disabled={isLoading}
              className={`${ACTION_BUTTON_CLASS} ${
                isLoading ? FILL_DISABLED_CLASS : FILL_INTERACTIVE_CLASS
              }`}
            >
              {t('tabCss.loadFile')}
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={!canExport}
              className={`${ACTION_BUTTON_CLASS} ${
                canExport ? FILL_INTERACTIVE_CLASS : FILL_DISABLED_CLASS
              }`}
            >
              {t('tabCss.export')}
            </button>
            <button
              type="button"
              onClick={handleClearCss}
              disabled={isLoading || !hasTabCss}
              className={`${ACTION_BUTTON_CLASS} ${
                hasTabCss
                  ? 'bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active text-danger-fg'
                  : FILL_DISABLED_CLASS
              }`}
            >
              {t('tabCss.remove')}
            </button>
          </div>
        </PropertySection>

        {/* 글로벌 히스토리 - 헤더 없이 목록만, 히스토리가 없으면 통째로 숨김 */}
        {history.length > 0 && (
          <div className="bg-fill-faint rounded-surface px-[10px]">
            {/* 4행(30px) + 상단 패딩 + 다섯째 행 24px 피크 - 하단 페이드(20px)가
                피크 구간에 걸려 잘림 대신 스크롤 여지로 읽힘 */}
            <div
              ref={historyScrollRef}
              className="max-h-[150px] overflow-y-auto modal-content-scroll dmn-scroll-fade"
            >
              <div className="flex flex-col py-[6px]">
                {history.map((item) => {
                  const badge = statusLabel(item);
                  const available = item.status === 'available';
                  const isCurrent = tabCss?.path === item.path;
                  const applicable = available && !isCurrent;
                  return (
                    <div
                      key={item.path}
                      className="flex items-center gap-[8px] min-h-[30px]"
                      title={item.path}
                    >
                      <span
                        className={`min-w-0 flex-1 truncate text-body ${
                          available ? 'text-fg' : 'text-fg-disabled'
                        }`}
                      >
                        {pathBaseName(item.path)}
                      </span>
                      {badge ? (
                        <span className="shrink-0 text-caption text-danger-fg">
                          {badge}
                        </span>
                      ) : null}
                      {isCurrent ? (
                        <span className="shrink-0 px-[8px] h-[23px] flex items-center text-body text-fg-muted">
                          {t('settings.cssApplied')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleApplyHistory(item)}
                          disabled={!applicable || pendingHistoryPath !== null}
                          className={`shrink-0 px-[8px] h-[23px] rounded-md flex items-center justify-center text-body transition-colors duration-fast ${
                            applicable
                              ? FILL_INTERACTIVE_CLASS
                              : FILL_DISABLED_CLASS
                          }`}
                        >
                          {t('settings.cssApply')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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
