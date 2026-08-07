import React from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import {
  FILL_DISABLED_CLASS,
  FILL_INTERACTIVE_CLASS,
  PANEL_APPLIED_LABEL_CLASS,
  PANEL_FOOTER_BUTTON_CLASS,
  PANEL_FOOTER_CLASS,
  PANEL_LIST_EMPTY_CLASS,
  PANEL_LIST_ROW_CLASS,
  PANEL_LIST_SCROLL_CLASS,
  PANEL_LIST_WELL_CLASS,
  PANEL_PILL_CLASS,
  PANEL_ROW_NAME_ACTIVE_CLASS,
  PANEL_ROW_NAME_CLASS,
  PANEL_ROW_NAME_UNAVAILABLE_CLASS,
  PANEL_SECTION_CLASS,
  PANEL_STATUS_BADGE_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { SettingToggleRow } from '@components/main/common/SettingRow';
import { SETTINGS_LABEL_CLASS, SETTINGS_ROW_CLASS } from '@utils/cardRecipes';
import ListPopup from '@components/main/Modal/ListPopup';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import { pathBaseName } from '@utils/core/pathDisplay';
import { cssHistoryStatusLabel } from '@utils/cssHistoryStatus';
import type {
  CssHistoryErrorCode,
  CssLoadResult,
  CustomCssHistoryItem,
} from '@src/types/plugin/api';

const CSS_HISTORY_ERROR_CODES: ReadonlySet<string> = new Set([
  'PATH_NOT_AUTHORIZED',
  'NOT_FOUND',
  'NOT_REGULAR_FILE',
  'INVALID_EXTENSION',
  'TOO_LARGE',
  'INVALID_UTF8',
  'IO_ERROR',
] satisfies CssHistoryErrorCode[]);

interface CssPanelContentProps {
  useCustomCSS: boolean;
  customCSSPath: string | null;
  onToggleCustomCSS: () => void;
  showAlert: (msg: string) => void;
  onClose: () => void;
  // 헤더 개수 배지용 히스토리 수 보고
  onHistoryCountChange?: (count: number) => void;
}

// 재진입 시 빈 상태 깜빡임 방지 - 마지막 목록을 모듈에 캐시 (사운드 피커와 같은 패턴)
let cssHistoryCache: CustomCssHistoryItem[] | null = null;

const CssPanelContent = ({
  useCustomCSS,
  customCSSPath,
  onToggleCustomCSS,
  showAlert,
  onClose,
  onHistoryCountChange,
}: CssPanelContentProps) => {
  const { t } = useTranslation();

  const [history, setHistory] = React.useState<CustomCssHistoryItem[]>(
    cssHistoryCache ?? [],
  );
  // 첫 조회 완료 전에는 빈 상태 문구를 띄우지 않음 (로딩 깜빡임 방지)
  const [hasLoaded, setHasLoaded] = React.useState(cssHistoryCache !== null);
  const [pendingPath, setPendingPath] = React.useState<string | null>(null);
  const [isLoadingNew, setIsLoadingNew] = React.useState(false);
  const pendingPathRef = React.useRef<string | null>(null);
  const loadingNewRef = React.useRef(false);
  const removingPathsRef = React.useRef(new Set<string>());

  const { scrollContainerRef: scrollRef } = useLenis();
  const menu = usePickerItemMenu<string>();

  // 겹친 조회·삭제 응답이 순서를 어길 때 최신 요청만 목록에 반영
  const historyRequestSeqRef = React.useRef(0);

  const applyHistoryResult = React.useCallback(
    (seq: number, items: CustomCssHistoryItem[]) => {
      if (seq === historyRequestSeqRef.current) {
        cssHistoryCache = items;
        setHistory(items);
        setHasLoaded(true);
        onHistoryCountChange?.(items.length);
      }
    },
    [onHistoryCountChange],
  );

  const refreshHistory = React.useCallback(async (): Promise<void> => {
    const seq = ++historyRequestSeqRef.current;
    try {
      applyHistoryResult(seq, await window.api.css.historyGet());
    } catch (error) {
      console.error('Failed to fetch CSS history', error);
      showAlert(t('settings.cssHistoryFetchFailed'));
    }
  }, [applyHistoryResult, showAlert, t]);

  // 캐시로 그린 목록과 헤더 배지가 첫 페인트부터 같은 수를 보이게 즉시 보고
  React.useEffect(() => {
    onHistoryCountChange?.(cssHistoryCache?.length ?? 0);
    void refreshHistory();
  }, [onHistoryCountChange, refreshHistory]);

  // 성공 시 스토어 갱신은 css:content 이벤트 구독(useAppBootstrap)에 일임
  // 응답으로 직접 쓰면 더 최신 이벤트를 이전 응답이 되덮을 수 있음
  const handleActivate = async (item: CustomCssHistoryItem): Promise<void> => {
    if (pendingPathRef.current) return;
    if (item.path === customCSSPath) return;
    pendingPathRef.current = item.path;
    setPendingPath(item.path);
    try {
      const result = await window.api.css.historyActivate(item.path);
      if (!result.success) {
        showAlert(
          result.code
            ? t(`settings.cssHistoryError.${result.code}`)
            : t('settings.cssLoadFailed'),
        );
      }
    } catch (error) {
      console.error('Failed to activate CSS from history', error);
      showAlert(`${t('settings.cssLoadFailed')}${error}`);
    } finally {
      pendingPathRef.current = null;
      setPendingPath(null);
      void refreshHistory();
    }
  };

  const handleRemove = async (path: string): Promise<void> => {
    if (removingPathsRef.current.has(path)) return;
    removingPathsRef.current.add(path);
    const seq = ++historyRequestSeqRef.current;
    try {
      applyHistoryResult(seq, await window.api.css.historyRemove(path));
    } catch (error) {
      console.error('Failed to remove CSS history entry', error);
      showAlert(t('settings.cssHistoryRemoveFailed'));
    } finally {
      removingPathsRef.current.delete(path);
    }
  };

  const handleLoadNew = async (): Promise<void> => {
    if (loadingNewRef.current) return;
    loadingNewRef.current = true;
    setIsLoadingNew(true);
    try {
      const result: CssLoadResult = await window.api.css.load();
      if (result.success) {
        showAlert(t('settings.cssLoaded'));
      } else if (result.error) {
        // 백엔드가 계약 오류 코드를 주면 번역 메시지로, 그 외엔 원문 그대로
        showAlert(
          CSS_HISTORY_ERROR_CODES.has(result.error)
            ? t(`settings.cssHistoryError.${result.error}`)
            : `${t('settings.cssLoadFailed')}${result.error}`,
        );
      }
    } catch (error) {
      console.error('Failed to load custom CSS', error);
      showAlert(`${t('settings.cssLoadFailed')}${error}`);
    } finally {
      loadingNewRef.current = false;
      setIsLoadingNew(false);
      void refreshHistory();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-[12px] pb-[12px] shrink-0">
        <div className={PANEL_SECTION_CLASS}>
          <SettingToggleRow
            commitStrategy="after-paint"
            label={t('settings.customCSS')}
            checked={useCustomCSS}
            onToggle={onToggleCustomCSS}
          />
          {/* 적용 중인 파일 - 전체 경로는 툴팁 */}
          <div className={`${SETTINGS_ROW_CLASS} gap-[10px]`}>
            <span className={`${SETTINGS_LABEL_CLASS} shrink-0`}>
              {t('settings.cssActiveFile')}
            </span>
            <span
              className={`text-body truncate min-w-0 ${
                useCustomCSS ? 'text-fg-muted' : 'text-fg-disabled'
              }`}
              title={customCSSPath || undefined}
            >
              {customCSSPath && customCSSPath.length > 0
                ? pathBaseName(customCSSPath)
                : t('settings.noCssFile')}
            </span>
          </div>
        </div>
      </div>

      {/* 리스트 테이블 - 패널 바닥까지 채우되 상하좌우 12px 여백 통일 */}
      <div className={PANEL_LIST_WELL_CLASS}>
        <div ref={scrollRef} className={PANEL_LIST_SCROLL_CLASS}>
          {history.length === 0 ? (
            hasLoaded ? (
              <div className={PANEL_LIST_EMPTY_CLASS}>
                {t('settings.cssHistoryEmpty')}
              </div>
            ) : null
          ) : (
            <div className="flex flex-col py-[8px]">
              {history.map((item) => {
                const isCurrent = item.path === customCSSPath;
                const available = item.status === 'available';
                const badge = cssHistoryStatusLabel(t, item);
                return (
                  <div
                    key={item.path}
                    role="button"
                    tabIndex={0}
                    onPointerDown={() => menu.capturePressState(item.path)}
                    onClick={(event) => menu.openFromRow(event, item.path)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        menu.openFromRow(event, item.path);
                      }
                    }}
                    onContextMenu={(event) =>
                      menu.openFromContextMenu(event, item.path)
                    }
                    className={PANEL_LIST_ROW_CLASS}
                    title={item.path}
                  >
                    <span
                      className={`${PANEL_ROW_NAME_CLASS} ${
                        available
                          ? PANEL_ROW_NAME_ACTIVE_CLASS
                          : PANEL_ROW_NAME_UNAVAILABLE_CLASS
                      }`}
                    >
                      {pathBaseName(item.path)}
                    </span>
                    {badge ? (
                      <span className={PANEL_STATUS_BADGE_CLASS}>{badge}</span>
                    ) : null}
                    {isCurrent ? (
                      <span className={PANEL_APPLIED_LABEL_CLASS}>
                        {t('settings.cssApplied')}
                      </span>
                    ) : (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleActivate(item);
                        }}
                        disabled={!available || pendingPath !== null}
                        className={`${PANEL_PILL_CLASS} ${
                          available
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
          )}
        </div>
      </div>

      {/* 하단 바 - 불러오기(주 액션, 크게) + 닫기 */}
      <div className={PANEL_FOOTER_CLASS}>
        <button
          onClick={() => void handleLoadNew()}
          disabled={isLoadingNew}
          className={`flex-[2] ${PANEL_FOOTER_BUTTON_CLASS} ${
            isLoadingNew ? FILL_DISABLED_CLASS : FILL_INTERACTIVE_CLASS
          }`}
        >
          {t('settings.loadCss')}
        </button>
        <button
          onClick={onClose}
          className={`flex-1 ${PANEL_FOOTER_BUTTON_CLASS} ${FILL_INTERACTIVE_CLASS}`}
        >
          {t('common.close')}
        </button>
      </div>

      {menu.menuKey !== null && (
        <ListPopup
          open
          ariaLabel={t('common.more')}
          position={menu.menuPosition ?? undefined}
          onClose={menu.close}
          items={[{ id: 'remove', label: t('settings.cssHistoryRemove') }]}
          onSelect={(id) => {
            const path = menu.menuKey;
            menu.close();
            if (id === 'remove' && path) void handleRemove(path);
          }}
          offsetX={0}
          offsetY={0}
        />
      )}
    </div>
  );
};

export default CssPanelContent;
