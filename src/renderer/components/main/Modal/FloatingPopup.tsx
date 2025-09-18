import React, { useEffect } from "react";
import {
  useFloating,
  offset as fuiOffset,
  shift,
  flip,
  autoUpdate,
} from "@floating-ui/react";

type FloatingPopupProps = {
  open: boolean;
  referenceRef?: React.RefObject<HTMLElement>;
  placement?: any;
  offset?: number;
  offsetX?: number;
  offsetY?: number;
  onClose?: () => void;
  className?: string;
  children?: React.ReactNode;
};

const FloatingPopup = ({
  open,
  referenceRef,
  placement = "top",
  offset = 20,
  offsetX = 0,
  offsetY = 0,
  onClose,
  className = "",
  children,
}: FloatingPopupProps) => {
  const { x, y, refs, strategy, update } = useFloating({
    placement,
    middleware: [fuiOffset(offset), shift(), flip()],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (referenceRef && referenceRef.current)
      refs.setReference(referenceRef.current);
  }, [referenceRef, refs.setReference]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };

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
      onClose?.();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickAway);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickAway);
    };
  }, [open, onClose, referenceRef, refs.floating]);

  useEffect(() => {
    if (open) update?.();
  }, [open, update]);

  if (!open) return null;

  return (
    <div
      ref={refs.setFloating as any}
      style={{
        position: strategy,
        left: (x ?? 0) + offsetX,
        top: (y ?? 0) + offsetY,
      }}
      className={`${className} tooltip-fade-in`}
      role="dialog"
      aria-modal="false"
    >
      {children}
    </div>
  );
};

export default FloatingPopup;
