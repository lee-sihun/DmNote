/* eslint-disable react-hooks/refs */
import React from 'react';
import Modal from '@components/main/Modal/Modal';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import { isMac } from '@utils/core/platform';
// import { TooltipGroup } from "@components/main/Modal/TooltipGroup";
// import FloatingTooltip from "@components/main/Modal/FloatingTooltip";
import { PropertySection } from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import type {
  ShortcutBinding,
  ShortcutsState,
} from '@src/types/settings/shortcuts';
import { getDefaultShortcuts } from '@src/renderer/defaults';

type ShortcutKey = keyof ShortcutsState;

interface ShortcutSettingsModalProps {
  isOpen: boolean;
  shortcuts: ShortcutsState;
  onClose: () => void;
  onSave: (next: ShortcutsState) => Promise<void> | void;
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

function formatShortcut(binding: ShortcutBinding, macOS: boolean): string {
  if (!binding?.key) return '';

  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push(macOS ? 'Cmd' : 'Win');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');

  const key = binding.key;
  const displayKey =
    key.startsWith('Key') && key.length === 4
      ? key.slice(3)
      : key.startsWith('Digit') && key.length === 6
      ? key.slice(5)
      : key === 'Space'
      ? 'Space'
      : key;

  parts.push(displayKey);
  return parts.join(' + ');
}

function isSameShortcut(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    !!a.meta === !!b.meta
  );
}

function getPlatformDefaults(macOS: boolean): ShortcutsState {
  const defaults = getDefaultShortcuts();
  if (!macOS) return defaults;
  return {
    ...defaults,
    toggleOverlay: {
      ...defaults.toggleOverlay,
      ctrl: false,
      meta: true,
    },
    toggleSettingsPanel: {
      ...defaults.toggleSettingsPanel,
      ctrl: false,
      meta: true,
    },
    zoomIn: {
      ...defaults.zoomIn,
      ctrl: false,
      meta: true,
    },
    zoomOut: {
      ...defaults.zoomOut,
      ctrl: false,
      meta: true,
    },
    resetZoom: {
      ...defaults.resetZoom,
      ctrl: false,
      meta: true,
    },
  };
}

const ShortcutSettingsModal = ({
  isOpen,
  shortcuts,
  onClose,
  onSave,
}: ShortcutSettingsModalProps) => {
  const { t } = useTranslation();
  const macOS = isMac();
  const defaults = getPlatformDefaults(macOS);

  const [draft, setDraft] = React.useState<ShortcutsState>(shortcuts);
  const [listeningKey, setListeningKey] = React.useState<ShortcutKey | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const isListening = listeningKey !== null;

  const safeDraft: ShortcutsState = { ...defaults, ...draft };

  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = React.useState<number | null>(
    null,
  );
  const [hasOverflow, setHasOverflow] = React.useState(false);
  const isFirstRender = React.useRef(true);

  const {
    scrollContainerRef: scrollRef,
    wrapperElement,
    scrollbarWidth,
  } = useLenis();

  React.useEffect(() => {
    if (isOpen) {
      setDraft(shortcuts);
      setListeningKey(null);
      setError(null);
    }
  }, [isOpen, shortcuts]);

  React.useEffect(() => {
    if (!isOpen) return;

    const el = wrapperElement;
    const inner = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (!inner) return;
      const contentHeight = inner.scrollHeight;
      const maxHeight = 235;
      setContainerHeight(Math.min(contentHeight, maxHeight));
      const nextHasOverflow = contentHeight > maxHeight;
      setHasOverflow((prev) =>
        prev === nextHasOverflow ? prev : nextHasOverflow,
      );
    };

    const resizeObserver = new ResizeObserver(updateHeight);
    if (inner) resizeObserver.observe(inner);
    resizeObserver.observe(el);

    updateHeight();

    const rafId = requestAnimationFrame(() => {
      isFirstRender.current = false;
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [isOpen, draft, wrapperElement]);

  React.useEffect(() => {
    if (!isListening) return;

    window.__dmn_isKeyListening = true;

    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const code = e.code || '';
      const mods = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      };

      if (
        code === 'Escape' &&
        !mods.ctrl &&
        !mods.shift &&
        !mods.alt &&
        !mods.meta
      ) {
        setListeningKey(null);
        return;
      }

      if (
        code === 'Backspace' &&
        !mods.ctrl &&
        !mods.shift &&
        !mods.alt &&
        !mods.meta
      ) {
        setDraft((prev) => ({ ...prev, [listeningKey!]: { key: '' } }));
        setListeningKey(null);
        return;
      }

      if (!code || MODIFIER_CODES.has(code)) return;

      const nextBinding: ShortcutBinding = {
        key: code,
        ...mods,
      };

      setDraft((prev) => ({ ...prev, [listeningKey!]: nextBinding }));
      setListeningKey(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', block, true);
    window.addEventListener('keypress', block, true);

    return () => {
      window.__dmn_isKeyListening = false;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', block, true);
      window.removeEventListener('keypress', block, true);
    };
  }, [isListening, listeningKey]);

  const actions = [
    // 오버레이
    {
      section: 'overlay' as const,
      key: 'toggleOverlay' as const,
      label: t('shortcutSetting.toggleOverlay'),
      help: t('shortcutSetting.toggleOverlayHint'),
    },
    {
      section: 'overlay' as const,
      key: 'toggleOverlayLock' as const,
      label: t('shortcutSetting.toggleOverlayLock'),
      help: t('shortcutSetting.toggleOverlayLockHint'),
    },
    {
      section: 'overlay' as const,
      key: 'toggleAlwaysOnTop' as const,
      label: t('shortcutSetting.toggleAlwaysOnTop'),
      help: t('shortcutSetting.toggleAlwaysOnTopHint'),
    },

    // 캔버스
    {
      section: 'canvas' as const,
      key: 'toggleSettingsPanel' as const,
      label: t('shortcutSetting.toggleSidePanel'),
      help: t('shortcutSetting.toggleSidePanelHint'),
    },
    {
      section: 'canvas' as const,
      key: 'switchKeyMode' as const,
      label: t('shortcutSetting.switchKeyMode'),
      help: t('shortcutSetting.switchKeyModeHint'),
    },
    {
      section: 'canvas' as const,
      key: 'zoomIn' as const,
      label: t('shortcutSetting.zoomIn'),
      help: t('shortcutSetting.zoomInHint'),
    },
    {
      section: 'canvas' as const,
      key: 'zoomOut' as const,
      label: t('shortcutSetting.zoomOut'),
      help: t('shortcutSetting.zoomOutHint'),
    },
    {
      section: 'canvas' as const,
      key: 'resetZoom' as const,
      label: t('shortcutSetting.resetZoom'),
      help: t('shortcutSetting.resetZoomHint'),
    },
  ] as const;

  const overlayActions = actions.filter((a) => a.section === 'overlay');
  const canvasActions = actions.filter((a) => a.section === 'canvas');

  const validate = (next: ShortcutsState) => {
    const entries = actions.map((a) => [a.key, next[a.key]] as const);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [keyA, bindA] = entries[i];
        const [keyB, bindB] = entries[j];
        if (bindA.key && bindB.key && isSameShortcut(bindA, bindB)) {
          const nameA = actions.find((a) => a.key === keyA)?.label || keyA;
          const nameB = actions.find((a) => a.key === keyB)?.label || keyB;
          return t('shortcutSetting.duplicate', { a: nameA, b: nameB });
        }
      }
    }
    return null;
  };

  const handleStartListening = (key: ShortcutKey) => {
    setError(null);
    setListeningKey((prev) => (prev === key ? null : key));
  };

  // const handleReset = () => {
  //   setError(null);
  //   setListeningKey(null);
  //   setDraft(defaults);
  // };

  const handleSave = async () => {
    const validationError = validate(safeDraft);
    setError(validationError);
    if (validationError) return;
    await onSave(safeDraft);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      onClick={() => {
        if (isListening) {
          setError(null);
          setListeningKey(null);
          return;
        }
        onClose();
      }}
    >
      <div
        className="flex flex-col min-w-[320px] bg-glass-heavy backdrop-blur-[32px] rounded-[14px] shadow-elevation-3 p-[20px]"
        onClick={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => {
          if (!isListening) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest('button')) return;
          setError(null);
          setListeningKey(null);
        }}
      >
        <div className="relative">
          <div
            ref={scrollRef}
            className="overflow-y-auto modal-content-scroll dmn-scroll-fade -mr-[14px] pr-[14px]"
            style={{
              height:
                containerHeight !== null ? `${containerHeight}px` : 'auto',
              maxHeight: '235px',
              width:
                hasOverflow && scrollbarWidth > 0
                  ? `calc(100% + ${scrollbarWidth}px)`
                  : undefined,
              transform:
                hasOverflow && scrollbarWidth > 0
                  ? `translateX(-${scrollbarWidth}px)`
                  : undefined,
              paddingLeft:
                hasOverflow && scrollbarWidth > 0
                  ? `${scrollbarWidth}px`
                  : undefined,
              transition: isFirstRender.current
                ? 'none'
                : 'height 100ms ease-in-out',
            }}
          >
            <div ref={contentRef} className="flex flex-col gap-[16px] py-[4px]">
              <div className="flex flex-col gap-[8px]">
                <p className="px-[2px] text-caption text-fg-faint uppercase tracking-wider">
                  {t('shortcutSetting.sectionOverlay')}
                </p>
                <PropertySection>
                  {overlayActions.map((action) => {
                    const binding = safeDraft[action.key];
                    const isRowListening = listeningKey === action.key;
                    const formatted = formatShortcut(binding, macOS);
                    const display = isRowListening
                      ? t('shortcutSetting.listening')
                      : formatted || t('shortcutSetting.unassigned');

                    return (
                      <div
                        key={action.key}
                        className="flex items-center justify-between min-h-[32px]"
                      >
                        {/* 툴팁 비활성화 */}
                        {/*
                          <FloatingTooltip content={action.help}>
                            <span className="text-body text-fg cursor-help">
                              {action.label}
                            </span>
                          </FloatingTooltip>
                        */}
                        <span className="text-body text-fg">
                          {action.label}
                        </span>
                        <button
                          onClick={() => handleStartListening(action.key)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setError(null);
                            setListeningKey(null);
                            setDraft((prev) => ({
                              ...prev,
                              [action.key]: { key: '' },
                            }));
                          }}
                          className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
                            isRowListening ? 'shadow-focus-ring' : ''
                          } text-fg text-style-2`}
                        >
                          {display}
                        </button>
                      </div>
                    );
                  })}
                </PropertySection>
              </div>

              <div className="flex flex-col gap-[8px]">
                <p className="px-[2px] text-caption text-fg-faint uppercase tracking-wider">
                  {t('shortcutSetting.sectionCanvas')}
                </p>
                <PropertySection>
                  {canvasActions.map((action) => {
                    const binding = safeDraft[action.key];
                    const isRowListening = listeningKey === action.key;
                    const formatted = formatShortcut(binding, macOS);
                    const display = isRowListening
                      ? t('shortcutSetting.listening')
                      : formatted || t('shortcutSetting.unassigned');

                    return (
                      <div
                        key={action.key}
                        className="flex items-center justify-between min-h-[32px]"
                      >
                        {/* 툴팁 비활성화 */}
                        {/*
                          <FloatingTooltip content={action.help}>
                            <span className="text-body text-fg cursor-help">
                              {action.label}
                            </span>
                          </FloatingTooltip>
                        */}
                        <span className="text-body text-fg">
                          {action.label}
                        </span>
                        <button
                          onClick={() => handleStartListening(action.key)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setError(null);
                            setListeningKey(null);
                            setDraft((prev) => ({
                              ...prev,
                              [action.key]: { key: '' },
                            }));
                          }}
                          className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
                            isRowListening ? 'shadow-focus-ring' : ''
                          } text-fg text-style-2`}
                        >
                          {display}
                        </button>
                      </div>
                    );
                  })}
                </PropertySection>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-[12px] px-[10px] py-[8px] bg-danger-muted rounded-md text-body text-danger-fg">
            {error}
          </div>
        ) : null}

        <div className="flex gap-[8px] mt-[19px]">
          <button
            className="flex-1 h-[30px] bg-accent hover:bg-accent-hover active:bg-accent-active rounded-lg text-accent-fg text-label transition-colors duration-fast"
            onClick={handleSave}
            disabled={isListening}
            style={
              isListening ? { opacity: 0.6, pointerEvents: 'none' } : undefined
            }
          >
            {t('shortcutSetting.save')}
          </button>
          <button
            className="px-[24px] h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-lg text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            onClick={onClose}
            disabled={isListening}
            style={
              isListening ? { opacity: 0.6, pointerEvents: 'none' } : undefined
            }
          >
            {t('shortcutSetting.cancel')}
          </button>
          {/* <button
            className="w-[75px] h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-lg text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            onClick={handleReset}
            disabled={isListening}
            style={
              isListening ? { opacity: 0.6, pointerEvents: "none" } : undefined
            }
          >
            {t("shortcutSetting.reset")}
          </button> */}
        </div>
      </div>
    </Modal>
  );
};

export default ShortcutSettingsModal;
