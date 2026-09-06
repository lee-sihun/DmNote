import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';
import { isHTMLElementNode } from '@utils/dom/isElementNode';

// --ui-duration-page와 동기
const PAGE_EXIT_MS = 250;

interface UsePanelNavigationOptions {
  hostDocument: Document;
  activeTab: string;
  panelMode: string;
  isPanelVisible: boolean;
  selectedKeyType: string;
  panelScopeKey: string;
  hasPluginSettingsPanel: boolean;
  pluginSettingsCancelRef: RefObject<() => void>;
}

export const usePanelNavigation = ({
  hostDocument,
  activeTab,
  panelMode,
  isPanelVisible,
  selectedKeyType,
  panelScopeKey,
  hasPluginSettingsPanel,
  pluginSettingsCancelRef,
}: UsePanelNavigationOptions) => {
  const [activePageKey, setActivePageKey] = useState<string | null>(null);
  const [renderPageKey, setRenderPageKey] = useState<string | null>(null);
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const pageExitTimerRef = useRef<number | null>(null);

  const openPage = useCallback((key: string) => {
    if (pageExitTimerRef.current !== null) {
      window.clearTimeout(pageExitTimerRef.current);
      pageExitTimerRef.current = null;
    }
    setActivePageKey(key);
    setRenderPageKey(key);
  }, []);

  const closePage = useCallback(() => {
    setActivePageKey(null);
    if (pageExitTimerRef.current !== null) {
      window.clearTimeout(pageExitTimerRef.current);
    }
    pageExitTimerRef.current = window.setTimeout(() => {
      pageExitTimerRef.current = null;
      setRenderPageKey(null);
    }, PAGE_EXIT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (pageExitTimerRef.current !== null) {
        window.clearTimeout(pageExitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 뷰 경계 변경 시 열린 서브 페이지 무효화
    closePage();
  }, [activeTab, panelMode, isPanelVisible, selectedKeyType, closePage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 선택 라우트 변경 시 트리거와 페이지 수명 동기화
    closePage();
  }, [panelScopeKey, closePage]);

  useEffect(() => {
    if (!activePageKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (
        isHTMLElementNode(target) &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (
        document.querySelector(
          '[data-dmn-modal-backdrop="true"], [data-dmn-popup-layer="true"]',
        ) ||
        (hostDocument !== document &&
          hostDocument.querySelector('[data-dmn-popup-layer="true"]'))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closePage();
    };
    hostDocument.addEventListener('keydown', onKey, true);
    return () => hostDocument.removeEventListener('keydown', onKey, true);
  }, [activePageKey, closePage, hostDocument]);

  useEffect(() => {
    if (!hasPluginSettingsPanel || activePageKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (
        isHTMLElementNode(target) &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (
        document.querySelector(
          '[data-dmn-modal-backdrop="true"], [data-dmn-popup-layer="true"]',
        ) ||
        (hostDocument !== document &&
          hostDocument.querySelector('[data-dmn-popup-layer="true"]'))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pluginSettingsCancelRef.current();
    };
    hostDocument.addEventListener('keydown', onKey, true);
    return () => hostDocument.removeEventListener('keydown', onKey, true);
  }, [
    hasPluginSettingsPanel,
    activePageKey,
    hostDocument,
    pluginSettingsCancelRef,
  ]);

  return {
    activePageKey,
    renderPageKey,
    pageHost,
    setPageHost,
    openPage,
    closePage,
  };
};
