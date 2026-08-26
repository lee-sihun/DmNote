/* eslint-disable react-hooks/set-state-in-effect */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  offset as fuiOffset,
  shift,
  flip,
  autoUpdate,
  type Middleware,
  type Placement,
} from '@floating-ui/react';
import {
  getFocusableElements,
  isAvailableFocusTarget,
} from '@utils/focusableElements';
import {
  usePopupPresence,
  type PopupMotionState,
} from '@hooks/ui/usePopupPresence';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';
import { useFocusRestore } from '@hooks/ui/useFocusRestore';
import { useDeferredContentMount } from '@hooks/ui/useDeferredContentMount';
import { FloatingPopupMotionContext } from './floatingPopupMotion';
import {
  isInsideHigherPopupLayer,
  isTopmostPopupLayer,
  registerPopupLayer,
} from './popupLayer';
import { clampToViewport, POPUP_EDGE_PADDING } from '@utils/ui/popupGeometry';
import { usePanelHost } from '@contexts/PanelHostContext';
import { isElementNode } from '@utils/dom/isElementNode';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface FloatingPopupBaseProps {
  open: boolean;
  ariaLabel: string;
  referenceRef?: React.RefObject<HTMLElement>;
  placement?: string;
  offset?: number;
  offsetX?: number;
  offsetY?: number;
  fixedX?: number;
  fixedY?: number;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  onClose: () => void;
  className?: string;
  children?: React.ReactNode;
  autoClose?: boolean;
  closeOnScroll?: boolean; // 스크롤 시 닫을지 여부
  portalToBody?: boolean;
  /** 트리거 폭에 맞추는 메뉴용 - 내용이 더 넓으면 내용을 따른다 */
  minWidth?: number;
  /** 모션 전면 차단 - 등퇴장이 없어야 하는 표면과 테스트용 탈출구 */
  animate?: boolean;
  /** 좌표 실측이 끝나기 전에는 false - 감춰진 프레임에 등장 모션이 소비되는 걸 막는다 */
  motionReady?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  focusOriginRef?: React.MutableRefObject<HTMLElement | null>;
  /** surface: 열릴 때 첫 포커서블 대신 팝업 표면에 포커스 (입력 필드 자동 포커스 방지) */
  initialFocus?: 'first' | 'surface';
  /** 팝업 shell을 먼저 표시하고 무거운 children mount를 첫 paint 뒤로 분리 */
  contentMountStrategy?: CommitStrategy;
}

interface FloatingDialogPopupProps extends FloatingPopupBaseProps {
  role?: 'dialog';
  onMenuTab?: never;
}

interface FloatingMenuPopupProps extends FloatingPopupBaseProps {
  role: 'menu';
  onMenuTab: (event: KeyboardEvent) => void;
}

type FloatingPopupProps = FloatingDialogPopupProps | FloatingMenuPopupProps;

const viewportOffset = (x: number, y: number): Middleware => ({
  name: 'viewportOffset',
  options: { x, y },
  fn: ({ x: currentX, y: currentY }) => ({
    x: currentX + x,
    y: currentY + y,
  }),
});

interface FloatingPopupSurfaceProps {
  setFloating: (node: HTMLDivElement | null) => void;
  style: React.CSSProperties;
  className: string;
  /** 열려 있는 동안만 true - 닫힘 모션이 도는 잔상 구간에서는 false */
  active: boolean;
  motionState?: PopupMotionState;
  placement?: string;
  role: 'dialog' | 'menu';
  ariaLabel: string;
  onMenuTab?: (event: KeyboardEvent) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  focusOriginRef?: React.MutableRefObject<HTMLElement | null>;
  initialFocus?: 'first' | 'surface';
  contentReady: boolean;
  children?: React.ReactNode;
}

const FloatingPopupSurface = ({
  setFloating,
  style,
  className,
  active,
  motionState,
  placement,
  role,
  ariaLabel,
  onMenuTab,
  onKeyDown,
  focusOriginRef,
  initialFocus = 'first',
  contentReady,
  children,
}: FloatingPopupSurfaceProps) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  // 분리 패널 창 안에서는 그 창의 document가 포커스·키 이벤트의 주인이다
  const { document: ownerDocument } = usePanelHost();
  const { openerRef, captureOpener } = useFocusRestore(active, ownerDocument);

  // 자식 팝업은 부모 모달의 layout 등록 뒤에 쌓여야 하므로 passive effect 사용.
  // 닫힘 모션이 도는 동안 DOM은 남지만 레이어 소유권은 즉시 놓는다
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!active || !surface) return;
    return registerPopupLayer(surface);
  }, [active]);

  // active를 의존성에 두는 건 퇴장 유예 때문이다. 닫히는 중 다시 열리면 표면이
  // 재사용돼 마운트 1회 전제로는 초기 포커스가 다시 잡히지 않는다
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!active || !surface) return;
    captureOpener(surface);
    if (focusOriginRef) {
      focusOriginRef.current = openerRef.current;
    }
    // 표면이 사는 문서의 포커스만 본다 (분리 패널 창이면 그 창)
    const activeElement = surface.ownerDocument.activeElement;
    if (
      contentReady &&
      activeElement !== surface &&
      surface.contains(activeElement)
    ) {
      return;
    }
    const initialTarget =
      !contentReady || initialFocus === 'surface'
        ? surface
        : role === 'menu'
        ? Array.from(
            surface.querySelectorAll<HTMLElement>(
              '[role^="menuitem"]:not(:disabled)',
            ),
          ).find(isAvailableFocusTarget) ?? surface
        : getFocusableElements(surface)[0] ?? surface;
    initialTarget.focus();
  }, [
    active,
    captureOpener,
    contentReady,
    focusOriginRef,
    initialFocus,
    openerRef,
    role,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const surface = surfaceRef.current;
      if (!isTopmostPopupLayer(surface)) return;

      if (role === 'menu') {
        onMenuTab?.(event);
        return;
      }

      event.preventDefault();
      const focusable = getFocusableElements(surface);
      if (focusable.length === 0) {
        surface.focus();
        return;
      }

      const activeIndex = focusable.indexOf(
        ownerDocument.activeElement as HTMLElement,
      );
      const nextIndex =
        activeIndex < 0
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) %
            focusable.length;
      focusable[nextIndex].focus();
    };

    ownerDocument.addEventListener('keydown', onKey);
    return () => ownerDocument.removeEventListener('keydown', onKey);
  }, [onMenuTab, role, ownerDocument]);

  return (
    <div
      ref={(node) => {
        setFloating(node);
        surfaceRef.current = node;
      }}
      style={style}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-modal={role === 'dialog' ? false : undefined}
      data-dmn-popup-layer="true"
      data-dmn-floating-popup="true"
      data-dmn-motion-state={motionState}
      data-dmn-placement={placement}
      // 닫히는 중엔 시각 잔상만 남으므로 포커스·스크린리더 대상에서 뺀다
      inert={motionState === 'closing'}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
};

const FloatingPopup = ({
  open,
  ariaLabel,
  role = 'dialog',
  referenceRef,
  placement = 'top',
  offset = 20,
  offsetX = 0,
  offsetY = 0,
  fixedX,
  fixedY,
  interactiveRefs = [],
  onClose,
  className = '',
  children,
  autoClose = true,
  closeOnScroll = false,
  portalToBody = false,
  minWidth,
  animate = true,
  motionReady = true,
  onKeyDown,
  onMenuTab,
  focusOriginRef,
  initialFocus,
  contentMountStrategy = 'sync',
}: FloatingPopupProps) => {
  // 앵커가 사는 창 기준으로 배치·포털·바깥 클릭을 처리한다 (분리 패널 창 지원)
  const { window: ownerWindow, document: ownerDocument } = usePanelHost();
  const {
    x,
    y,
    refs,
    strategy,
    update,
    // flip·shift를 거친 최종 배치 - 등퇴장 원점을 실제 방향에 맞추는 근거
    placement: resolvedPlacement,
    isPositioned,
  } = useFloating({
    // open을 넘겨야 isPositioned가 닫힐 때 false로 되돌아간다. 안 넘기면 첫 배치
    // 이후 계속 true라 두 번째 열림부터 등장 상태가 한 프레임도 안 그려지고 합쳐진다
    open,
    placement: placement as Placement,
    // flip이 먼저 방향을 정하고 shift가 남은 넘침만 밀어야 한다.
    // 순서가 바뀌면 shift가 밀어둔 결과를 flip이 다시 뒤집어 어긋난다
    middleware: [
      fuiOffset(offset),
      viewportOffset(offsetX, offsetY),
      flip(),
      shift({ padding: POPUP_EDGE_PADDING }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const floatingRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const deferredContentMounted = useDeferredContentMount(
    open && contentMountStrategy !== 'sync',
  );

  // 퇴장 중에는 마지막 children을 유지한다. open에 묶으면 PopupExit가 붙잡은
  // 내용도 닫는 첫 렌더에서 비어 퇴장 잔상과 미저장 편집 상태가 사라진다
  const contentMounted =
    contentMountStrategy === 'sync' || deferredContentMounted;

  // 호출부는 닫으면서 좌표를 즉시 비운다. 그대로 두면 퇴장 중 isFixed가 뒤집혀
  // body 포털이 인라인 렌더로 바뀌고, 표면이 재마운트되며 모션·포커스·스크롤이 끊긴다.
  // 렌더 루트를 마운트 내내 고정하려면 마지막 열림 좌표를 붙잡아야 한다
  const { x: shownFixedX, y: shownFixedY } = useRetainedWhileOpen(open, {
    x: fixedX,
    y: fixedY,
  });

  // 기준 요소가 없으면 Floating UI가 배치를 확정할 일이 없다.
  // 그때까지 등장을 막으면 팝업이 영영 안 보이므로 게이트에서 뺀다
  const usesFloatingPosition =
    referenceRef !== undefined &&
    (typeof shownFixedX !== 'number' || typeof shownFixedY !== 'number');

  // Floating UI 배치는 비동기다. 좌표가 확정되기 전에 등장을 시작하면
  // 원점(0,0)에서 한 프레임 그려진 뒤 제자리로 튀어 모션이 묻힌다.
  // 지연 마운트 children도 같은 이유로 기다린다 - 빈 셸 크기로 잡은 자리에서
  // 등장을 시작하면 내용이 붙는 순간 클램프·flip이 다시 돌아 제자리로 튄다
  const { mounted, state: motionState } = usePopupPresence(open, {
    enabled: animate,
    ready:
      motionReady && (!usesFloatingPosition || isPositioned) && contentMounted,
    motionRef: floatingRef,
  });

  // 의존성을 걸면 ref 객체 교체만 보고 그 안의 노드 교체는 놓친다. 트리거가
  // 사라졌다 다시 생기거나 여러 버튼이 ref 하나를 돌려쓰면, Floating UI가 연결
  // 끊긴 옛 노드를 계속 재서 팝업이 화면 좌상단으로 날아간다.
  // 매 렌더 동기화가 노드 교체를 잡는 유일한 방법이고, 같은 노드면 내부에서 무시된다.
  // paint 전에 맞춰야 이전 좌표가 한 프레임 비치지 않는다.
  // null은 밀지 않는다 - 끊으면 좌표가 0으로 초기화돼 팝업이 좌상단으로 튄다
  useLayoutEffect(() => {
    const node = referenceRef?.current;
    if (node) refs.setReference(node);
  });

  // Escape 소유는 autoClose와 무관 — 한 번에 한 겹씩 닫힘.
  // 위에 body 포털 서브메뉴가 떠 있으면 그쪽이 상위 레이어이므로 양보
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!isTopmostPopupLayer(floatingRef.current)) return;
      // 이 레이어가 소비 — 하위 레이어(페이지·그리드 선택)로 내려가지 않게
      e.preventDefault();
      onClose();
    };
    ownerDocument.addEventListener('keydown', onKey);
    return () => ownerDocument.removeEventListener('keydown', onKey);
  }, [open, onClose, ownerDocument]);

  useEffect(() => {
    if (open && autoClose) {
      const onClickAway = (e: MouseEvent) => {
        const target = e.target as Node;
        if (!refs.floating.current) return;
        if (
          refs.floating.current.contains(target) ||
          (referenceRef &&
            referenceRef.current &&
            referenceRef.current.contains(target))
        )
          return;
        // 모달이 열린 상태에서 모달 내부 클릭으로 팝업이 닫히는 것을 방지
        // (Modal은 body로 portal 렌더링되기 때문에 floating 내부로 인식되지 않음)
        const isInsideModal =
          isElementNode(target) &&
          !!target.closest('[data-dmn-modal-backdrop="true"]');
        if (isInsideModal) return;
        // 서브메뉴도 body 포털이라 floating 내부로 인식되지 않음 — 닫힘 예외
        const isInsideSubMenu =
          isElementNode(target) &&
          !!target.closest('[data-dmn-popup-submenu="true"]');
        if (isInsideSubMenu) return;
        // 온캔버스 그라데이션 핸들 조작도 팝업 편집의 연장 — 닫힘 예외
        const isInsideGradientOverlay =
          isElementNode(target) &&
          !!target.closest('[data-dmn-gradient-overlay="true"]');
        if (isInsideGradientOverlay) return;
        // 위에 쌓인 팝업(자식 피커 등)은 body 포털이라 floating 내부로 인식되지 않음
        if (isInsideHigherPopupLayer(refs.floating.current, target)) return;
        onClose();
      };

      ownerDocument.addEventListener('mousedown', onClickAway);
      return () => {
        ownerDocument.removeEventListener('mousedown', onClickAway);
      };
    }
  }, [open, autoClose, onClose, referenceRef, refs.floating, ownerDocument]);

  useEffect(() => {
    if (open) update?.();
  }, [open, update]);

  // closeOnScroll: 스크롤 시 팝업 닫기
  useEffect(() => {
    if (!open || !closeOnScroll) return;

    const handleScroll = () => {
      onClose();
    };

    // 캡처 단계에서 모든 스크롤 이벤트 감지
    ownerDocument.addEventListener('scroll', handleScroll, true);

    return () => {
      ownerDocument.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, closeOnScroll, onClose, ownerDocument]);

  // 좌표가 바뀔 때마다 옵저버를 다시 만들 필요는 없다. 고정 모드인지만 보면 된다
  const isFixedMode =
    typeof shownFixedX === 'number' && typeof shownFixedY === 'number';

  // 고정 좌표 사용 시 메뉴 위치를 조정
  const place = useCallback(() => {
    // 닫히는 중엔 좌표를 얼린다. scale 보간 중 rect를 다시 재면 팝업이 흐른다
    if (motionState === 'closing') return;
    if (
      !mounted ||
      !floatingRef.current ||
      typeof shownFixedX !== 'number' ||
      typeof shownFixedY !== 'number'
    ) {
      setAdjustedPos(null);
      return;
    }

    // 등장 모션이 scale을 보간하는 중이라 rect는 실제보다 작게 나온다.
    // offsetWidth/Height는 transform을 무시하므로 최종 크기를 그대로 준다
    const { offsetWidth: menuWidth, offsetHeight: menuHeight } =
      floatingRef.current;
    const x = clampToViewport(
      shownFixedX + offsetX,
      menuWidth,
      ownerWindow.innerWidth,
    );
    const y = clampToViewport(
      shownFixedY + offsetY,
      menuHeight,
      ownerWindow.innerHeight,
    );

    setAdjustedPos((prev) => (prev?.x === x && prev.y === y ? prev : { x, y }));
  }, [
    mounted,
    motionState,
    shownFixedX,
    shownFixedY,
    offsetX,
    offsetY,
    ownerWindow,
  ]);

  // contentMounted가 빠지면 지연 마운트 팝업이 내용 없는 상태(폭 8px)에서 한 번만
  // 재고 그대로 굳는다. 내용이 붙어도 다시 재지 않아 경계 밖으로 잘려 나간다
  useLayoutEffect(place, [place, contentMounted]);

  // 내용이 나중에 커지거나(비동기 로드, 폰트 스왑) 창 크기가 바뀌면 다시 잰다
  useEffect(() => {
    const el = floatingRef.current;
    if (!mounted || !el || !isFixedMode) return;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(el);
    ownerWindow.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener('resize', place);
    };
  }, [mounted, isFixedMode, place, ownerWindow]);

  useEffect(() => {
    if (!open || autoClose) return;

    let pointerCapturedInside = false;

    const referenceEl = referenceRef?.current ?? null;

    const _handlePointerDownInside = () => {
      pointerCapturedInside = true;
    };

    const handlePointerUp = () => {
      pointerCapturedInside = false;
    };

    const handleDocumentDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // floatingRef.current를 이벤트 발생 시점에 동적으로 참조
      const floatingEl = floatingRef.current;
      const interactiveEls = interactiveRefs
        .map((r) => r?.current)
        .filter(Boolean) as HTMLElement[];
      const isInsideModal =
        isElementNode(target) &&
        !!target.closest('[data-dmn-modal-backdrop="true"]');

      if (!floatingEl) return;

      const isInsideFloating = floatingEl.contains(target);
      const isInsideReference = referenceEl?.contains(target) ?? false;
      const isInsideInteractive = interactiveEls.some((el) =>
        el.contains(target as Node),
      );

      if (isInsideFloating) {
        pointerCapturedInside = true;
        return;
      }

      if (
        pointerCapturedInside &&
        (event.type === 'pointerdown' || event.type === 'mousedown')
      ) {
        pointerCapturedInside = false;
      }

      if (isInsideReference || isInsideInteractive) {
        pointerCapturedInside = false;
        return;
      }

      // 모달이 열린 상태에서 모달 내부 클릭으로 팝업이 닫히는 것을 방지.
      // (Modal은 body로 portal 렌더링되기 때문에 단순 z-index로는 해결이 안 됨)
      if (isInsideModal) {
        pointerCapturedInside = false;
        return;
      }

      // 서브메뉴·포털 드롭다운도 body 포털이라 floating 내부로 인식되지 않음
      const isInsideSubMenu =
        isElementNode(target) &&
        !!target.closest('[data-dmn-popup-submenu="true"]');
      if (isInsideSubMenu) {
        pointerCapturedInside = false;
        return;
      }

      // 온캔버스 그라데이션 핸들 조작도 팝업 편집의 연장 — 닫힘 예외
      const isInsideGradientOverlay =
        isElementNode(target) &&
        !!target.closest('[data-dmn-gradient-overlay="true"]');
      if (isInsideGradientOverlay) {
        pointerCapturedInside = false;
        return;
      }

      // 위에 쌓인 팝업(자식 피커 등)은 body 포털이라 floating 내부로 인식되지 않음
      if (isInsideHigherPopupLayer(floatingEl, target)) {
        pointerCapturedInside = false;
        return;
      }

      if (pointerCapturedInside) {
        return;
      }

      onClose();
    };

    // 이벤트 리스너는 document에만 등록 (floatingEl은 동적으로 참조)
    ownerDocument.addEventListener('pointerup', handlePointerUp, true);
    ownerDocument.addEventListener('pointerdown', handleDocumentDown, true);
    ownerDocument.addEventListener('mousedown', handleDocumentDown, true);

    return () => {
      ownerDocument.removeEventListener('pointerup', handlePointerUp, true);
      ownerDocument.removeEventListener(
        'pointerdown',
        handleDocumentDown,
        true,
      );
      ownerDocument.removeEventListener('mousedown', handleDocumentDown, true);
    };
  }, [open, autoClose, onClose, referenceRef, interactiveRefs, ownerDocument]);

  if (!mounted) return null;

  // 고정 좌표를 사용할 때는 조정된 위치, 아니면 기본 위치를 사용합
  let left: number;
  let top: number;

  if (isFixedMode && adjustedPos) {
    left = adjustedPos.x;
    top = adjustedPos.y;
  } else if (isFixedMode) {
    // adjustedPos 계산 대기 중이면 기본 위치 사용
    left = (shownFixedX as number) + offsetX;
    top = (shownFixedY as number) + offsetY;
  } else {
    left = x ?? 0;
    top = y ?? 0;
  }

  const floatingContent = (
    <FloatingPopupSurface
      setFloating={(node) => {
        refs.setFloating(node);
        floatingRef.current = node;
      }}
      style={{
        position: isFixedMode ? 'fixed' : strategy,
        left,
        top,
        minWidth,
      }}
      className={className}
      active={open}
      motionState={animate ? motionState : undefined}
      // 고정 좌표는 Floating UI 배치를 우회하므로 기준 방향이 없다
      placement={animate && !isFixedMode ? resolvedPlacement : undefined}
      role={role}
      ariaLabel={ariaLabel}
      onMenuTab={onMenuTab}
      onKeyDown={onKeyDown}
      focusOriginRef={focusOriginRef}
      initialFocus={initialFocus}
      contentReady={contentMounted}
    >
      <FloatingPopupMotionContext.Provider value={motionState}>
        {contentMounted ? children : null}
      </FloatingPopupMotionContext.Provider>
    </FloatingPopupSurface>
  );

  // 위치 계산 전후에 렌더 루트가 바뀌지 않도록 필요 시 처음부터 body에 렌더링
  if (portalToBody || isFixedMode) {
    return createPortal(floatingContent, ownerDocument.body);
  }

  return floatingContent;
};

export default FloatingPopup;
