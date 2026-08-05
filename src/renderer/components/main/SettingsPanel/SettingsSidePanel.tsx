import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  isTopmostPopupLayer,
  registerPopupLayer,
} from '@components/main/Modal/popupLayer';

export type SettingsPanelKey = 'shortcuts' | 'plugins' | 'css';

export interface SettingsPanelPage {
  key: SettingsPanelKey;
  title: string;
  // 헤더 우측 개수 배지 (예: "2개")
  headerBadge?: string;
  content: React.ReactNode;
}

interface SettingsSidePanelProps {
  activePanel: SettingsPanelKey;
  pages: SettingsPanelPage[];
  onClose: () => void;
}

// 우측 고정 페인의 상세 상태 - 표면은 부모 페인이 소유, 애니메이션 없이 즉시 표시
const SETTINGS_PANEL_FRAME_CLASS = 'absolute inset-0 flex flex-col';

const SettingsSidePanel = ({
  activePanel,
  pages,
  onClose,
}: SettingsSidePanelProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 열기 전 포커스를 첫 렌더 시점에 캡처, 닫힐 때 마지막 트리거로 복원
  const prevFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null,
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return registerPopupLayer(root);
  }, []);

  // 비모달 패널, 포커스 트랩 없이 진입 포커스만 이동
  // 열린 상태에서 다른 트리거로 전환해도 트리거 캡처와 포커스 이동을 다시 수행
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && !root.contains(active)) {
      prevFocusedRef.current = active;
      root.focus();
    }
  }, [activePanel]);

  useEffect(() => {
    return () => {
      const prevFocused = prevFocusedRef.current;
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };
  }, []);

  // 최상위 팝업 레이어일 때만 Escape 소유 (위에 뜬 모달·드롭다운이 우선)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (window.__dmn_isKeyListening) return;
      if (!isTopmostPopupLayer(rootRef.current)) return;
      e.preventDefault();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const activePage = pages.find((page) => page.key === activePanel);
  const activeTitle = activePage?.title;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={activeTitle}
      tabIndex={-1}
      className={SETTINGS_PANEL_FRAME_CLASS}
    >
      {/* 헤더 - 타이틀 좌측, 우측에 개수 배지 */}
      <div className="flex items-center justify-between gap-[10px] h-[48px] px-[12px] shrink-0">
        <span className="text-title text-fg truncate min-w-0">
          {activeTitle}
        </span>
        {activePage?.headerBadge ? (
          <span className="shrink-0 text-body text-fg-faint tabular-nums">
            {activePage.headerBadge}
          </span>
        ) : null}
      </div>
      <div className="relative flex-1 min-h-0">
        {/* 활성 페이지만 마운트 - 전환 애니메이션 없이 즉시 표시가 의도 */}
        {pages.map((page) =>
          page.key === activePanel ? (
            <div key={page.key} className="absolute inset-0 flex flex-col">
              {page.content}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
};

export default SettingsSidePanel;
