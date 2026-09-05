import React, { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import FloatingPopup from './FloatingPopup';
import { useViewportSize } from '@hooks/ui/useViewportSize';
import { getListScrollMetrics } from './listScrollMetrics';
import { useLenis } from '@hooks/useLenis';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { CANVAS_POPUP_CHROME_CLASS } from './popupChrome';
import {
  emptySiblingActive,
  getAdjacentFocusTarget,
  handleMenuNavigation,
  isSeparator,
  MenuItemRow,
  SeparatorRow,
  trackPointer,
  type ListItem,
  type SiblingActive,
} from './listPopupMenuRows';

export type {
  ListItem,
  ListMenuItem,
  ListSeparator,
} from './listPopupMenuRows';

interface ListPopupProps {
  open: boolean;
  ariaLabel: string;
  referenceRef?: React.RefObject<HTMLElement>;
  position?: { x: number; y: number };
  onClose: () => void;
  items: ListItem[];
  onSelect?: (id: string) => void;
  className?: string;
  offsetX?: number;
  offsetY?: number;
  contentMountStrategy?: CommitStrategy;
  /** 앵커 기준 배치 방향 (referenceRef를 쓸 때만 의미) */
  placement?: string;
  /** 트리거 폭 정렬용 최소 폭 */
  minWidth?: number;
  /** 앵커와의 간격 */
  offset?: number;
  /** 스크롤·contain 조상 안에서 열릴 때 필요 */
  portalToBody?: boolean;
}
const ListPopup = ({
  open,
  ariaLabel,
  referenceRef,
  position,
  onClose,
  items,
  onSelect,
  className = '',
  offsetX = 0,
  offsetY = 0,
  contentMountStrategy = 'after-paint',
  placement = 'top',
  minWidth,
  offset = 25,
  portalToBody = false,
}: ListPopupProps) => {
  const openerRef = useRef<HTMLElement | null>(null);

  const handleMenuTab = (event: KeyboardEvent) => {
    event.preventDefault();
    const origin = referenceRef?.current ?? openerRef.current;
    const target = getAdjacentFocusTarget(origin, event.shiftKey);
    flushSync(onClose);
    if (target?.isConnected) {
      target.focus();
    } else if (origin?.isConnected) {
      origin.focus();
    }
  };

  // 일시적 팝업은 상주 크롬(패널·미니맵)보다 항상 위 - 사다리는 tokens.css가 소유
  // z는 호출부가 덮을 수 있어야 한다. 기본값을 클래스로 박으면 두 클래스가
  // 같은 특이도로 충돌해 CSS 생성 순서에 따라 결과가 달라진다
  const defaultClassName = `dmn-motion ${CANVAS_POPUP_CHROME_CLASS} rounded-surface p-[5px] flex flex-col gap-[4px]`;
  const zClassName = /(^|\s)z-/.test(className)
    ? ''
    : 'z-[var(--z-chrome-popup)]';
  const effectiveClassName =
    `${defaultClassName} ${zClassName} ${className}`.trim();

  const { height: viewportHeight } = useViewportSize();
  const { needsScroll, maxHeight } = getListScrollMetrics(
    items.length,
    viewportHeight,
    items.filter(isSeparator).length,
  );
  const hasCheckColumn = items.some(
    (it) => !isSeparator(it) && typeof it.checked === 'boolean',
  );

  const siblingActiveRef = useRef<SiblingActive>(emptySiblingActive());

  // ListPopup은 닫혀도 마운트를 유지한다(FloatingPopup이 표면만 거둔다).
  // 세션 상태를 두면 다음 열림의 첫 호버가 형제 전환으로 오인돼 지연도 모션도 사라진다.
  // 닫는 순간이 아니라 여는 순간에 비운다 - 닫힘 애니메이션 동안 살아 있는 행의
  // 호버 타이머가 뒤늦게 ref를 다시 채워도 새 세션은 깨끗하게 시작한다
  useEffect(() => {
    if (!open) return;
    siblingActiveRef.current = emptySiblingActive();
  }, [open]);

  const { scrollContainerRef: lenisRef } = useLenis({
    wheelMultiplier: 0.7,
  });

  return (
    <FloatingPopup
      open={open}
      role="menu"
      ariaLabel={ariaLabel}
      onMenuTab={handleMenuTab}
      focusOriginRef={openerRef}
      referenceRef={referenceRef}
      placement={placement}
      minWidth={minWidth}
      portalToBody={portalToBody}
      offset={offset}
      offsetX={offsetX}
      offsetY={offsetY}
      fixedX={position?.x}
      fixedY={position?.y}
      onClose={onClose}
      onKeyDown={handleMenuNavigation}
      className={effectiveClassName}
      contentMountStrategy={contentMountStrategy}
    >
      <div
        ref={needsScroll ? lenisRef : undefined}
        style={
          maxHeight
            ? { maxHeight, overflowY: 'auto', overflowX: 'hidden' }
            : undefined
        }
        role="none"
        onMouseMove={(event) => trackPointer(siblingActiveRef, event)}
        className={`flex flex-col gap-[4px]${
          needsScroll ? ' listpopup-scroll dmn-scroll-fade' : ''
        }`}
      >
        {items.map((it) =>
          isSeparator(it) ? (
            <SeparatorRow key={it.id} />
          ) : (
            <MenuItemRow
              key={it.id}
              item={it}
              onSelect={onSelect}
              onCloseAll={onClose}
              onMenuTab={handleMenuTab}
              siblingActiveRef={siblingActiveRef}
              hasCheckColumn={hasCheckColumn}
            />
          ),
        )}
      </div>
    </FloatingPopup>
  );
};

export default ListPopup;
