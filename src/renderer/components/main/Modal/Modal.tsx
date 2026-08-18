import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { getFocusableElements } from '@utils/focusableElements';
import { useFocusRestore } from '@hooks/ui/useFocusRestore';
import { useDeferredContentMount } from '@hooks/ui/useDeferredContentMount';
import type { PopupMotionState } from '@hooks/ui/usePopupPresence';
import { isTopmostPopupLayer, registerPopupLayer } from './popupLayer';

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
  /** 모션 전면 차단 - 등퇴장이 없어야 하는 표면과 테스트용 탈출구 */
  animate?: boolean;
  /**
   * useModalPresence가 넘기는 등퇴장 상태. 부모가 조건부로 모달을 걷어내면
   * 퇴장 모션이 돌 자리가 없으므로, 수명은 호출부가 presence로 소유한다
   */
  motionState?: PopupMotionState;
  /** 스크린리더용 다이얼로그 이름 */
  ariaLabel?: string;
  /** 중앙 카드 대신 크롬 사이 영역을 통째로 덮는 전면 시트 */
  fullSurface?: boolean;
  /** 모달 shell을 먼저 표시하고 무거운 children mount를 첫 paint 뒤로 분리 */
  contentMountStrategy?: CommitStrategy;
}

const Modal = ({
  onClick,
  children,
  animate = true,
  motionState,
  ariaLabel,
  fullSurface = false,
  contentMountStrategy = 'sync',
}: ModalProps) => {
  const closing = motionState === 'closing';
  const scrimAnimClass = animate ? 'dmn-scrim-motion' : '';
  // 전면 시트는 등퇴장 모션 없이 즉시 표시
  const contentAnimClass = animate && !fullSurface ? 'dmn-motion-content' : '';
  const closeFromBackdropRef = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClick);
  // 닫히기 전에 아직 내용이 안 붙었다면 퇴장 잔상에서 무거운 children을 새로
  // 마운트하지 않는다. 이미 붙은 내용은 훅이 유지하므로 그대로 퇴장한다
  const deferredContentMounted = useDeferredContentMount(
    !closing && contentMountStrategy !== 'sync',
  );
  const contentReady =
    contentMountStrategy === 'sync' || deferredContentMounted;
  useEffect(() => {
    onCloseRef.current = onClick;
  });

  // 퇴장 유예 동안 DOM이 남으므로 열림 여부는 closing으로 판정한다
  const { captureOpener } = useFocusRestore(!closing);

  // 닫힘 모션이 도는 동안 DOM은 남지만 레이어 소유권은 즉시 놓는다.
  // 아니면 닫히는 모달이 Escape와 Tab 순환을 계속 물고 있다
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (closing || !backdrop) return;
    return registerPopupLayer(backdrop);
  }, [closing]);

  useEffect(() => {
    const reset = () => {
      closeFromBackdropRef.current = false;
    };
    document.addEventListener('pointercancel', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('pointercancel', reset, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // 자식 autoFocus를 존중하고, 지정이 없으면 첫 조작 요소로 포커스 이동.
  // closing을 의존성에 두는 건 퇴장 유예 때문이다. 닫히는 중 다시 열리면
  // 인스턴스가 재사용돼 마운트 1회 전제로는 포커스가 다시 잡히지 않는다
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (closing || !backdrop) return;
    captureOpener(backdrop);
    if (
      contentReady &&
      document.activeElement !== backdrop &&
      backdrop.contains(document.activeElement)
    ) {
      return;
    }
    const initialTarget = getFocusableElements(backdrop)[0] ?? backdrop;
    initialTarget.focus();
  }, [captureOpener, closing, contentReady]);

  // 최상위 모달만 Escape와 Tab 포커스 순환을 소유
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!isTopmostPopupLayer(backdropRef.current)) return;

      if (e.key === 'Tab') {
        const backdrop = backdropRef.current;
        if (!backdrop) return;
        const focusable = getFocusableElements(backdrop);
        if (focusable.length === 0) {
          e.preventDefault();
          backdrop.focus();
          return;
        }

        const active = document.activeElement;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!backdrop.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === backdrop)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      if (e.key !== 'Escape') return;
      // 키 리스닝 중엔 양보 — Escape는 리스닝 취소로 예약됨 (raw input 레이스 포함)
      if (window.__dmn_isKeyListening) return;
      e.preventDefault();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleBackdropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // only mark if pointer started directly on the backdrop
    closeFromBackdropRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // ignore clicks that bubbled up from content
    if (e.target !== e.currentTarget) return;
    // ignore clicks without a matching pointerDown on backdrop (e.g. window drag)
    if (!closeFromBackdropRef.current) return;
    closeFromBackdropRef.current = false;
    onClick?.();
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  // 포털이어도 React 합성 이벤트는 React 트리로 버블링 - 그리드 등 뒤 표면의
  // 우클릭 메뉴가 모달 위 우클릭에 반응하지 않게 차단
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // 텍스트 입력의 네이티브 편집 메뉴는 보존
    const target = e.target as HTMLElement;
    if (!target.closest('input, textarea, [contenteditable="true"]')) {
      e.preventDefault();
    }
  };

  // 스크림 딤은 모달의 조상이 아니라 형제 언더레이가 소유해야 함 —
  // 조상이 backdrop-filter나 반투명을 가지면 backdrop root가 생겨 모달 카드
  // 글래스의 블러가 WebKit에서 배경을 샘플링하지 못함. 형제 레이어는 정상 합성됨
  // 조상 opacity 애니메이션도 같은 이유로 금지 — opacity < 1인 조상이
  // backdrop root가 되어 페이드 동안 블러가 죽었다가 끝나는 순간 튐.
  // 그래서 dmn-motion-content는 래퍼가 아닌 직계 자식(> *)에 적용되고,
  // 등퇴장 모션은 스크림(틴트 전환)과 콘텐츠 루트가 각자 소유한다
  // 스크림은 검은 딤 + 은은한 상수 블러, 블러 보간만 금지 (Windows 렉 요인)
  return createPortal(
    <div
      ref={backdropRef}
      data-dmn-modal-backdrop="true"
      data-dmn-motion-state={animate ? motionState : undefined}
      data-dmn-motion-variant="modal"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      // 닫히는 중엔 시각 잔상만 남으므로 포커스·스크린리더 대상에서 뺀다
      inert={closing}
      tabIndex={-1}
      className="fixed top-[30px] bottom-[60px] left-0 right-0 flex items-center justify-center z-50"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    >
      {/* 스크림 언더레이 — 클릭은 래퍼로 통과.
          전면 시트는 스크림 생략 — 시트가 영역을 다 덮어 어둡히기가 무의미하고,
          스크림이 겹치면 같은 글래스 토큰인데 사이드 패널보다 어둡게 합성됨
          스크림 알파는 카드 글래스 투과와 곱으로 결합 — --ui-glass-heavy와 함께 조절 */}
      {!fullSurface && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 backdrop-glass-scrim pointer-events-none ${scrimAnimClass}`}
        />
      )}
      <div
        className={`${
          fullSurface ? 'absolute inset-0' : 'relative'
        } ${contentAnimClass}`}
      >
        {contentReady ? children : null}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
