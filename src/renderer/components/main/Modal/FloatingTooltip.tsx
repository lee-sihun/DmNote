import React, { useState, useRef, useId, useContext } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  arrow,
  autoUpdate,
} from "@floating-ui/react";
import { TooltipGroupContext } from "./TooltipGroup";

type FloatingTooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number; // ms to wait before showing tooltip on hover
};

const FloatingTooltip = ({
  content,
  children,
  placement = "top",
  delay = 500,
}: FloatingTooltipProps) => {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const group = useContext(TooltipGroupContext);

  const { x, y, refs, strategy, middlewareData } = useFloating({
    placement,
    middleware: [offset(8), flip(), shift(), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  // When a pointer (mouse/touch) interaction clicks the reference element,
  // it will also trigger a focus event. We want pointer interactions to close
  // the tooltip and NOT immediately reopen via the focus handler. Use a ref
  // to ignore the next focus event if it was caused by a pointer interaction.
  const ignoreFocusRef = useRef(false);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  // track whether this open should animate (first in group)
  const shouldAnimateOpenRef = useRef<boolean>(false);

  // timer ref for hover delay
  const openTimerRef = useRef<number | null>(null);

  const startOpenTimer = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    const effectiveDelay = group?.getEffectiveDelay(delay) ?? delay;
    // decide animation for this upcoming open
    shouldAnimateOpenRef.current = !!group?.shouldAnimate?.();

    const finalizeOpen = () => {
      if (shouldAnimateOpenRef.current) {
        group?.consumeAnimation?.();
      }
      handleOpen();
    };

    if (effectiveDelay <= 0) {
      finalizeOpen();
      return;
    }
    openTimerRef.current = window.setTimeout(() => {
      finalizeOpen();
      openTimerRef.current = null;
    }, effectiveDelay) as unknown as number;
  };

  const cancelOpenTimer = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    // reset pending animation flag
    shouldAnimateOpenRef.current = false;
  };

  const handlePointerDown = () => {
    // cancel any pending open timer, mark that the next focus should be ignored and close tooltip
    cancelOpenTimer();
    ignoreFocusRef.current = true;
    setOpen(false);
  };

  const handleFocus = () => {
    if (ignoreFocusRef.current) {
      // consume the focus caused by pointer interaction and reset flag
      ignoreFocusRef.current = false;
      return;
    }
    handleOpen();
  };

  // ensure timers are cleaned up on unmount
  React.useEffect(() => {
    return () => {
      cancelOpenTimer();
    };
  }, []);

  const arrowX = middlewareData.arrow?.x ?? 0;
  const arrowY = middlewareData.arrow?.y ?? 0;

  const arrowStyle: React.CSSProperties = {};
  // placement may include variations like "top-start", so check startsWith
  if (placement.startsWith("top")) {
    arrowStyle.left = `${arrowX}px`;
    arrowStyle.bottom = "-4px";
  } else if (placement.startsWith("bottom")) {
    arrowStyle.left = `${arrowX}px`;
    arrowStyle.top = "-4px";
  } else if (placement.startsWith("left")) {
    arrowStyle.top = `${arrowY}px`;
    arrowStyle.right = "-4px";
  } else {
    arrowStyle.top = `${arrowY}px`;
    arrowStyle.left = "-4px";
  }

  return (
    <>
      <div
        ref={refs.setReference}
        onMouseEnter={startOpenTimer}
        onMouseLeave={() => {
          cancelOpenTimer();
          handleClose();
        }}
        onPointerDown={handlePointerDown}
        onFocus={handleFocus}
        onBlur={handleClose}
        aria-describedby={open ? id : undefined}
        className="inline-flex"
      >
        {children}
      </div>
      {open && (
        <div
          id={id}
          ref={refs.setFloating}
          role="tooltip"
          style={{
            position: strategy,
            top: y ?? 0,
            left: x ?? 0,
            zIndex: 50,
          }}
          className={
            shouldAnimateOpenRef.current ? "tooltip-fade-in" : undefined
          }
        >
          <div className="bg-[#1E1E22] text-[#EDEDED] text-[12px] px-2 py-1 rounded-md shadow-sm">
            {content}
          </div>
          <div
            ref={arrowRef}
            style={arrowStyle}
            className="w-[8px] h-[8px] rotate-45 bg-[#1E1E22] absolute pointer-events-none"
          />
        </div>
      )}
    </>
  );
};

export default FloatingTooltip;
