import React, { useState, useRef, useId } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  arrow,
  autoUpdate,
} from "@floating-ui/react";

type FloatingTooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
};

const FloatingTooltip = ({
  content,
  children,
  placement = "top",
}: FloatingTooltipProps) => {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const { x, y, refs, strategy, middlewareData } = useFloating({
    placement,
    middleware: [offset(8), flip(), shift(), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

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
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
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
            zIndex: 9999,
          }}
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
