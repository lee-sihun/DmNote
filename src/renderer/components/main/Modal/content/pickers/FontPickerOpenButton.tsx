import { useEffect, useRef, type ReactNode } from 'react';
import { preloadFontPickerFonts } from './fontPickerPreload';

interface FontPickerOpenButtonProps {
  activePageKey: string | null;
  pageKey: string;
  onOpen: () => void;
  onClose: () => void;
  onBeforeOpen?: () => void;
  children: ReactNode;
}

const FontPickerOpenButton = ({
  activePageKey,
  pageKey,
  onOpen,
  onClose,
  onBeforeOpen,
  children,
}: FontPickerOpenButtonProps) => {
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
  }, [activePageKey]);

  const preload = (targetDocument: Document) => {
    void preloadFontPickerFonts(targetDocument);
  };

  return (
    <button
      type="button"
      className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
        activePageKey === pageKey ? 'shadow-focus-ring' : ''
      } text-fg text-body`}
      onPointerEnter={(event) => preload(event.currentTarget.ownerDocument)}
      onFocus={(event) => preload(event.currentTarget.ownerDocument)}
      onClick={(event) => {
        const requestId = ++requestIdRef.current;
        if (activePageKey === pageKey) {
          onClose();
          return;
        }

        onBeforeOpen?.();
        void preloadFontPickerFonts(event.currentTarget.ownerDocument).then(
          () => {
            if (!mountedRef.current || requestIdRef.current !== requestId) {
              return;
            }
            onOpen();
          },
        );
      }}
    >
      {children}
    </button>
  );
};

export default FontPickerOpenButton;
