import React from 'react';
import { useLenis } from '@hooks/useLenis';
import { useTranslation } from '@contexts/useTranslation';
import { isMac } from '@utils/core/platform';
import {
  FILL_INTERACTIVE_CLASS,
  PANEL_FOOTER_BUTTON_CLASS,
  PANEL_SECTION_CLASS,
} from '@components/main/SettingsPanel/panelChrome';
import { SETTINGS_LABEL_CLASS, SETTINGS_ROW_CLASS } from '@utils/cardRecipes';
import type {
  ShortcutBinding,
  ShortcutsState,
} from '@src/types/settings/shortcuts';
import { getDefaultShortcuts } from '@src/renderer/defaults';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';

type ShortcutKey = keyof ShortcutsState;

interface ShortcutsPanelContentProps {
  shortcuts: ShortcutsState;
  onApply: (next: ShortcutsState) => Promise<void> | void;
  onClose: () => void;
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

// 저장 버튼 없는 즉시 적용 모델 - 키 확정·해제 순간 바로 settings에 반영
const ShortcutsPanelContent = ({
  shortcuts,
  onApply,
  onClose,
}: ShortcutsPanelContentProps) => {
  const { t } = useTranslation();
  const macOS = isMac();
  const defaults = getPlatformDefaults(macOS);

  const [listeningKey, setListeningKey] = React.useState<ShortcutKey | null>(
    null,
  );
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const isListening = listeningKey !== null;

  const current: ShortcutsState = { ...defaults, ...shortcuts };

  const { scrollContainerRef: scrollRef } = useLenis();

  const actions = [
    // 오버레이
    {
      section: 'overlay' as const,
      key: 'toggleOverlay' as const,
      label: t('shortcutSetting.toggleOverlay'),
    },
    {
      section: 'overlay' as const,
      key: 'toggleOverlayLock' as const,
      label: t('shortcutSetting.toggleOverlayLock'),
    },
    {
      section: 'overlay' as const,
      key: 'toggleAlwaysOnTop' as const,
      label: t('shortcutSetting.toggleAlwaysOnTop'),
    },

    // 캔버스
    {
      section: 'canvas' as const,
      key: 'toggleSettingsPanel' as const,
      label: t('shortcutSetting.toggleSidePanel'),
    },
    {
      section: 'canvas' as const,
      key: 'switchKeyMode' as const,
      label: t('shortcutSetting.switchKeyMode'),
    },
    {
      section: 'canvas' as const,
      key: 'zoomIn' as const,
      label: t('shortcutSetting.zoomIn'),
    },
    {
      section: 'canvas' as const,
      key: 'zoomOut' as const,
      label: t('shortcutSetting.zoomOut'),
    },
    {
      section: 'canvas' as const,
      key: 'resetZoom' as const,
      label: t('shortcutSetting.resetZoom'),
    },
  ] as const;

  // 저장 중 겹침 방지 - 연속 확정은 순서대로 하나씩만
  const applyShortcuts = async (next: ShortcutsState): Promise<void> => {
    setIsSaving(true);
    try {
      await onApply(next);
    } finally {
      setIsSaving(false);
    }
  };

  // 의도적으로 deps 미지정 - 매 렌더 재등록으로 listeningKey·shortcuts의
  // stale closure를 피한다 (캡처 단계 + 동기 재등록이라 관찰 가능한 틈 없음)
  React.useEffect(() => {
    if (!isListening) return;

    window.__dmn_isKeyListening = true;

    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isHistoryEditorFlushLocked()) return;
      e.preventDefault();
      e.stopPropagation();

      const code = e.code || '';
      const mods = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      };
      const noMods = !mods.ctrl && !mods.shift && !mods.alt && !mods.meta;
      const target = listeningKey!;
      const cur: ShortcutsState = { ...defaults, ...shortcuts };

      if (code === 'Escape' && noMods) {
        setListeningKey(null);
        return;
      }

      if (code === 'Backspace' && noMods) {
        setListeningKey(null);
        if (cur[target].key) {
          setNotice(null);
          void applyShortcuts({ ...cur, [target]: { key: '' } });
        }
        return;
      }

      if (!code || MODIFIER_CODES.has(code)) return;

      const nextBinding: ShortcutBinding = {
        key: code,
        ...mods,
      };
      setListeningKey(null);

      // 같은 값 재지정은 no-op (불필요한 저장·키보드 daemon 재시작 방지)
      if (isSameShortcut(cur[target], nextBinding)) return;

      const next: ShortcutsState = { ...cur, [target]: nextBinding };

      // 다른 동작에 걸린 같은 조합은 자동 해제 후 안내
      const conflict = actions.find(
        (action) =>
          action.key !== target &&
          cur[action.key].key &&
          isSameShortcut(cur[action.key], nextBinding),
      );
      if (conflict) {
        next[conflict.key] = { key: '' };
        setNotice(t('shortcutSetting.movedFrom', { name: conflict.label }));
      } else {
        setNotice(null);
      }
      void applyShortcuts(next);
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
  });

  const handleStartListening = (key: ShortcutKey) => {
    if (isSaving) return;
    setNotice(null);
    setListeningKey((prev) => (prev === key ? null : key));
  };

  const handleClear = (key: ShortcutKey) => {
    if (isSaving) return;
    setListeningKey(null);
    const cur: ShortcutsState = { ...defaults, ...shortcuts };
    if (!cur[key].key) return;
    setNotice(null);
    void applyShortcuts({ ...cur, [key]: { key: '' } });
  };

  const renderRow = (action: (typeof actions)[number]) => {
    const binding = current[action.key];
    const isRowListening = listeningKey === action.key;
    const formatted = formatShortcut(binding, macOS);
    const display = isRowListening
      ? t('shortcutSetting.listening')
      : formatted || t('shortcutSetting.unassigned');

    return (
      <div key={action.key} className={SETTINGS_ROW_CLASS}>
        <span className={SETTINGS_LABEL_CLASS}>{action.label}</span>
        <button
          onClick={() => handleStartListening(action.key)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleClear(action.key);
          }}
          className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md ${
            isRowListening ? 'shadow-focus-ring' : ''
          } text-fg text-label`}
        >
          {display}
        </button>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col h-full"
      onPointerDownCapture={(event) => {
        if (!isListening) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('button')) return;
        setListeningKey(null);
      }}
    >
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto modal-content-scroll dmn-scroll-fade"
      >
        <div className="px-[12px] pb-[12px] flex flex-col gap-[12px]">
          <div className={PANEL_SECTION_CLASS}>
            {actions
              .filter((a) => a.section === 'overlay')
              .map((action) => renderRow(action))}
          </div>

          <div className={PANEL_SECTION_CLASS}>
            {actions
              .filter((a) => a.section === 'canvas')
              .map((action) => renderRow(action))}
          </div>

          {notice ? (
            <div className="px-[10px] py-[8px] bg-inset rounded-surface text-label text-fg-muted">
              {notice}
            </div>
          ) : null}

          {/* 우클릭 해제·Backspace 초기화 안내 - 구 모달의 발견성 복원 */}
          <p className="px-[2px] text-caption text-fg-faint">
            {t('shortcutSetting.hint')}
          </p>
        </div>
      </div>

      {/* 하단 바 - 닫기 */}
      <div className="px-[12px] pb-[12px] shrink-0">
        <button
          onClick={onClose}
          className={`w-full ${PANEL_FOOTER_BUTTON_CLASS} ${FILL_INTERACTIVE_CLASS}`}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
};

export default ShortcutsPanelContent;
