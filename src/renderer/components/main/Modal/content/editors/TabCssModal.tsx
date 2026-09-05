import React, { useEffect, useState, useRef } from 'react';
import Modal from '../../Modal';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import Checkbox from '@components/main/common/Checkbox';
import { PropertySection } from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import {
  FILL_DISABLED_CLASS,
  FILL_QUIET_CLASS,
  FILL_QUIET_DISABLED_CLASS,
  FILL_INTERACTIVE_CLASS,
  PANEL_APPLIED_LABEL_CLASS,
  PANEL_PILL_CLASS,
  PANEL_STATUS_BADGE_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { FORM_ROW_CLASS, FORM_LABEL_CLASS } from '@utils/cardRecipes';
import { useTranslation } from '@contexts/useTranslation';
import { useLenis } from '@hooks/useLenis';
import { useOptimisticAsyncBooleanCommit } from '@hooks/useOptimisticAsyncBooleanCommit';
import { useKeyStore } from '@stores/data/useKeyStore';
import { pathBaseName } from '@utils/core/pathDisplay';
import { cssHistoryStatusLabel } from '@utils/cssHistoryStatus';
import type { CustomCssHistoryItem } from '@src/types/plugin/api';
import type { TabCss } from '@src/types/plugin/css';
import { cssApi } from '@api/modules/cssApi';

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
  const [isClosing, setIsClosing] = useState(false);

  const { scrollContainerRef: historyScrollRef } = useLenis();

  // 모달 열기 시점의 원본 상태 저장 (취소 시 복원용)
  const originalStateRef = useRef<TabCss | null>(null);

  // 진행 중 백엔드 변경 - 취소가 이보다 먼저 비교하면 취소한 변경이
  // 뒤늦게 커밋되는 레이스가 생기므로 취소 시 완료를 기다림
  const pendingMutationsRef = useRef(new Set<Promise<void>>());
  const loadRef = useRef(false);
  const clearRef = useRef(false);
  const exportRef = useRef(false);
  const historyRef = useRef<string | null>(null);
  const closingRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const invokeTracked = async <T,>(op: () => Promise<T>): Promise<T> => {
    const promise = op();
    const tracked = promise.then(
      () => undefined,
      () => undefined,
    );
    pendingMutationsRef.current.add(tracked);
    try {
      return await promise;
    } finally {
      pendingMutationsRef.current.delete(tracked);
    }
  };

  // 모달이 열릴 때 현재 탭의 CSS 정보와 글로벌 히스토리 로드, 원본 상태 저장
  useEffect(() => {
    if (!isOpen) return;

    const generation = ++loadGenerationRef.current;
    closingRef.current = false;
    setIsClosing(false);
    setIsLoading(true);
    window.api.css.tab
      .get(selectedKeyType)
      .then((tabResponse) => {
        if (generation !== loadGenerationRef.current) return;
        const css = tabResponse.css || null;
        setTabCss(css);
        // 원본 상태 깊은 복사로 저장
        originalStateRef.current = css ? { ...css } : null;
      })
      .catch((error) => {
        console.error('Failed to get CSS info:', error);
      })
      .finally(() => {
        if (generation === loadGenerationRef.current) setIsLoading(false);
      });

    window.api.css
      .historyGet()
      .then((items) => {
        if (generation === loadGenerationRef.current) setHistory(items);
      })
      .catch((error) => {
        console.error('Failed to fetch CSS history:', error);
      });
    return () => {
      loadGenerationRef.current += 1;
    };
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
    if (loadRef.current || closingRef.current) return;
    loadRef.current = true;
    setIsLoading(true);
    try {
      const result = await invokeTracked(() =>
        cssApi.tab.load(selectedKeyType),
      );
      if (result.success && result.css) {
        setTabCss(result.css);
      } else if (result.error) {
        showAlert?.(t('tabCss.loadFailed') + ': ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load tab CSS:', error);
    } finally {
      loadRef.current = false;
      setIsLoading(false);
    }
  };

  const handleClearCss = async () => {
    if (clearRef.current || closingRef.current) return;
    clearRef.current = true;
    try {
      const result = await invokeTracked(() =>
        cssApi.tab.clear(selectedKeyType),
      );
      if (result.success) {
        setTabCss(null);
      }
    } catch (error) {
      console.error('Failed to clear tab CSS:', error);
    } finally {
      clearRef.current = false;
    }
  };

  const commitCssEnabled = async (enabled: boolean) => {
    const result = await invokeTracked(() =>
      cssApi.tab.toggle(selectedKeyType, enabled),
    );
    if (!result.success) {
      throw new Error('Failed to toggle tab CSS');
    }

    setTabCss((prev) =>
      prev
        ? { ...prev, enabled: result.enabled }
        : { path: null, content: '', enabled: result.enabled },
    );
  };

  const {
    value: visualCssEnabled,
    toggle: handleToggleCss,
    flush: flushCssEnabled,
  } = useOptimisticAsyncBooleanCommit({
    canonicalValue: tabCss?.enabled ?? true,
    onCommit: commitCssEnabled,
    onError: (error) => {
      console.error('Failed to toggle tab CSS:', error);
      showAlert?.(t('common.saveFailed'));
    },
  });

  // 글로벌 히스토리 항목을 현재 탭 CSS로 적용
  const handleApplyHistory = async (item: CustomCssHistoryItem) => {
    if (historyRef.current || closingRef.current || item.status !== 'available')
      return;
    if (tabCss?.path === item.path) return;
    historyRef.current = item.path;
    setPendingHistoryPath(item.path);
    try {
      const result = await invokeTracked(() =>
        cssApi.tab.activateHistory(selectedKeyType, item.path),
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
      historyRef.current = null;
      setPendingHistoryPath(null);
    }
  };

  // 현재 탭 CSS 콘텐츠를 파일로 내보내기
  const handleExport = async () => {
    if (exportRef.current || closingRef.current) return;
    exportRef.current = true;
    setIsExporting(true);
    try {
      const result = await cssApi.tab.export(selectedKeyType);
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
      exportRef.current = false;
      setIsExporting(false);
    }
  };

  // 저장: 현재 상태 유지하고 모달 닫기
  const handleSave = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    await flushCssEnabled();
    if (pendingMutationsRef.current.size > 0) {
      await Promise.all([...pendingMutationsRef.current]);
    }
    onClose();
  };

  // 취소: 진행 중 변경 커밋을 기다린 뒤 백엔드 상태 기준으로 원본 복원
  // (로컬 state 비교는 응답 도착 전 취소 시 변경 없음으로 오판)
  const handleCancel = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    const original = originalStateRef.current;

    try {
      await flushCssEnabled();
      if (pendingMutationsRef.current.size > 0) {
        await Promise.all([...pendingMutationsRef.current]);
      }
      const { css } = await window.api.css.tab.get(selectedKeyType);
      const current = css || null;
      const statesAreDifferent =
        original?.path !== current?.path ||
        original?.content !== current?.content ||
        original?.enabled !== current?.enabled;

      if (statesAreDifferent) {
        // css.tab.set을 사용하여 원본 상태로 직접 복원
        await cssApi.tab.set(selectedKeyType, original);
      }
    } catch (error) {
      console.error('Failed to restore original state:', error);
    }

    onClose();
  };

  // 퇴장 모션이 도는 동안 DOM을 유지한다
  const { mounted, state: motionState } = useModalPresence(isOpen);

  if (!mounted) return null;

  const hasTabCss = Boolean(tabCss && tabCss.path);
  const canExport = Boolean(tabCss?.content) && !isExporting;

  return (
    <Modal
      motionState={motionState}
      onClick={handleCancel}
      ariaLabel={t('tabCss.enableCss')}
      contentMountStrategy="after-paint"
    >
      <div
        className="flex flex-col w-[288px] p-[14px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 gap-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상태 카드 - 토글, 적용 파일, 파일 액션 */}
        <PropertySection>
          {/* 행 전체가 button role=switch라 키보드로도 조작 가능 */}
          <button
            type="button"
            role="switch"
            aria-checked={visualCssEnabled}
            onClick={handleToggleCss}
            disabled={isClosing}
            data-dmn-press-scope=""
            className={`${FORM_ROW_CLASS} cursor-pointer`}
          >
            <span className={FORM_LABEL_CLASS}>{t('tabCss.enableCss')}</span>
            {/* 토글이 포인터를 받아야 노브 드래그가 산다. 닫히는 중에는 행 버튼의
                disabled가 안쪽까지 미치지 않으므로 그때만 다시 막는다 */}
            <span
              aria-hidden="true"
              className={isClosing ? 'pointer-events-none' : undefined}
            >
              <Checkbox checked={visualCssEnabled} onChange={handleToggleCss} />
            </span>
          </button>
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
              disabled={isLoading || isClosing}
              className={`${ACTION_BUTTON_CLASS} ${
                isLoading ? FILL_DISABLED_CLASS : FILL_INTERACTIVE_CLASS
              }`}
            >
              {t('tabCss.loadFile')}
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={!canExport || isClosing}
              className={`${ACTION_BUTTON_CLASS} ${
                canExport ? FILL_INTERACTIVE_CLASS : FILL_DISABLED_CLASS
              }`}
            >
              {t('tabCss.export')}
            </button>
            <button
              type="button"
              onClick={handleClearCss}
              disabled={isLoading || !hasTabCss || isClosing}
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
                  const badge = cssHistoryStatusLabel(t, item);
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
                        // 적용 중인 항목만 밝게 - 패널 히스토리와 같은 규칙
                        className={`min-w-0 flex-1 truncate text-body ${
                          isCurrent && available
                            ? 'text-fg'
                            : 'text-fg-disabled'
                        }`}
                      >
                        {pathBaseName(item.path)}
                      </span>
                      {badge ? (
                        <span className={PANEL_STATUS_BADGE_CLASS}>
                          {badge}
                        </span>
                      ) : null}
                      {isCurrent ? (
                        <span className={PANEL_APPLIED_LABEL_CLASS}>
                          {t('settings.cssApplied')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleApplyHistory(item)}
                          disabled={
                            !applicable ||
                            pendingHistoryPath !== null ||
                            isClosing
                          }
                          className={`${PANEL_PILL_CLASS} ${
                            applicable && pendingHistoryPath === null
                              ? FILL_QUIET_CLASS
                              : FILL_QUIET_DISABLED_CLASS
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
            onClick={() => void handleSave()}
            disabled={isClosing}
            className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
          >
            {t('keySetting.save')}
          </button>
          <button
            onClick={handleCancel}
            disabled={isClosing}
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
