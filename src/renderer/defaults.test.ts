import { beforeEach, describe, expect, it, vi } from 'vitest';

// 플랫폼 분기별 기본값 검증을 위해 모듈 격리 후 동적 로드
async function loadDefaults(mac: boolean) {
  vi.resetModules();
  vi.doMock('@utils/core/platform', () => ({ isMac: () => mac }));
  return await import('./defaults');
}

describe('부트스트랩 전 폴백 기본값 (Rust SettingsState::default 파리티 고정)', () => {
  beforeEach(() => {
    vi.doUnmock('@utils/core/platform');
    vi.resetModules();
  });

  it('비 macOS 기본값 전수 고정', async () => {
    const { getDefaultSettingsState } = await loadDefaults(false);

    const ctrlShortcut = (key: string, shift = false) => ({
      key,
      ctrl: true,
      shift,
      alt: false,
      meta: false,
    });

    expect(getDefaultSettingsState()).toEqual({
      hardwareAcceleration: true,
      alwaysOnTop: true,
      overlayLocked: false,
      noteEffect: false,
      noteSettings: {
        frameLimit: 0,
        speed: 400,
        trackHeight: 300,
        reverse: false,
        fadePosition: 'auto',
        fadeTopPx: 50,
        fadeBottomPx: 0,
        reverseFadeTopPx: 0,
        reverseFadeBottomPx: 50,
        delayedNoteEnabled: false,
        shortNoteThresholdMs: 50,
        shortNoteMinLengthPx: 30,
        keyDisplayDelayMs: 0,
      },
      fontSettings: { customFonts: [] },
      angleMode: 'd3d11',
      uiTheme: 'system',
      language: 'ko',
      laboratoryEnabled: false,
      developerModeEnabled: false,
      trayEnabled: false,
      autoUpdateEnabled: true,
      backgroundColor: 'transparent',
      useCustomCSS: false,
      customCSS: { path: null, content: '' },
      useCustomJS: false,
      customJS: { path: null, content: '', plugins: [] },
      overlayResizeAnchor: 'top-left',
      keyCounterEnabled: false,
      gridSettings: {
        alignmentGuides: true,
        spacingGuides: true,
        sizeMatchGuides: true,
        minimapEnabled: true,
        gridSnapSize: 5,
        overlayPadding: 30,
      },
      shortcuts: {
        toggleOverlay: ctrlShortcut('KeyO', true),
        toggleOverlayLock: { key: '' },
        toggleAlwaysOnTop: { key: '' },
        switchKeyMode: {
          key: 'Tab',
          ctrl: false,
          shift: false,
          alt: false,
          meta: false,
        },
        toggleSettingsPanel: ctrlShortcut('KeyB'),
        zoomIn: ctrlShortcut('Equal'),
        zoomOut: ctrlShortcut('Minus'),
        resetZoom: ctrlShortcut('Digit0'),
      },
      obsModeEnabled: false,
    });
  });

  it('macOS 드리프트 이력 필드 고정, angleMode는 metal 주 수정키는 meta', async () => {
    const { getDefaultSettingsState } = await loadDefaults(true);
    const d = getDefaultSettingsState();

    const metaShortcut = (key: string, shift = false) => ({
      key,
      ctrl: false,
      shift,
      alt: false,
      meta: true,
    });

    expect(d.angleMode).toBe('metal');
    expect(d.shortcuts.toggleOverlay).toEqual(metaShortcut('KeyO', true));
    expect(d.shortcuts.toggleSettingsPanel).toEqual(metaShortcut('KeyB'));
    expect(d.shortcuts.zoomIn).toEqual(metaShortcut('Equal'));
    expect(d.shortcuts.zoomOut).toEqual(metaShortcut('Minus'));
    expect(d.shortcuts.resetZoom).toEqual(metaShortcut('Digit0'));
    expect(d.shortcuts.switchKeyMode.meta).toBe(false);
    expect(d.shortcuts.switchKeyMode.ctrl).toBe(false);
  });

  it('파생 소비처가 canonical 단일 원천을 참조', async () => {
    vi.resetModules();
    const [defaults, overlayDefaults, noteSettings] = await Promise.all([
      import('./defaults'),
      import('@constants/overlayDefaults'),
      import('@src/types/settings/noteSettings'),
    ]);

    // overlayDefaults는 canonical 객체 자체를 재노출
    expect(overlayDefaults.DEFAULT_NOTE_SETTINGS).toBe(
      defaults.NOTE_SETTINGS_FALLBACK,
    );
    expect(defaults.getDefaultNoteSettings()).toEqual(
      defaults.NOTE_SETTINGS_FALLBACK,
    );

    // fadePosition 누락 입력의 zod 기본값이 canonical에서 유도됨
    const withoutFade: Record<string, unknown> = {
      ...defaults.getDefaultNoteSettings(),
    };
    delete withoutFade.fadePosition;
    const parsed = noteSettings.noteSettingsSchema.parse(withoutFade);
    expect(parsed.fadePosition).toBe(
      defaults.NOTE_SETTINGS_FALLBACK.fadePosition,
    );
    expect(parsed.fadePosition).toBe('auto');
  });
});
