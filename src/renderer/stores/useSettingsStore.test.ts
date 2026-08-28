import { beforeEach, describe, expect, it } from 'vitest';
import {
  useSettingsStore,
  type SettingsStateSnapshot,
} from '@stores/useSettingsStore';
import {
  getDefaultNoteSettings,
  getDefaultFontSettings,
  getDefaultGridSettings,
  getDefaultShortcuts,
} from '@src/renderer/defaults';

const createSnapshot = (
  overrides: Partial<SettingsStateSnapshot> = {},
): SettingsStateSnapshot => ({
  hardwareAcceleration: true,
  alwaysOnTop: true,
  overlayLocked: false,
  angleMode: 'd3d11',
  uiTheme: 'system',
  noteEffect: true,
  noteSettings: getDefaultNoteSettings(),
  tabNoteOverrides: {},
  fontSettings: getDefaultFontSettings(),
  useCustomCSS: false,
  customCSSContent: '',
  customCSSPath: null,
  useCustomJS: false,
  jsPlugins: [],
  backgroundColor: '#000000',
  language: 'ko',
  laboratoryEnabled: false,
  developerModeEnabled: false,
  trayEnabled: false,
  autoUpdateEnabled: true,
  overlayResizeAnchor: 'top-left',
  keyCounterEnabled: false,
  gridSettings: getDefaultGridSettings(),
  shortcuts: getDefaultShortcuts(),
  obsModeEnabled: true,
  ...overrides,
});

describe('useSettingsStore.syncFromSnapshot', () => {
  beforeEach(() => {
    useSettingsStore.getState().setAll(createSnapshot());
  });

  it('동일 payload 재적용 시 모든 객체 필드 참조를 보존한다', () => {
    const before = useSettingsStore.getState();

    useSettingsStore.getState().syncFromSnapshot(createSnapshot());

    const after = useSettingsStore.getState();
    expect(after.noteSettings).toBe(before.noteSettings);
    expect(after.fontSettings).toBe(before.fontSettings);
    expect(after.gridSettings).toBe(before.gridSettings);
    expect(after.shortcuts).toBe(before.shortcuts);
    expect(after.jsPlugins).toBe(before.jsPlugins);
    expect(after.tabNoteOverrides).toBe(before.tabNoteOverrides);
  });

  it('원시 필드 변경 시 해당 필드만 갱신하고 객체 참조는 유지한다', () => {
    const before = useSettingsStore.getState();

    useSettingsStore
      .getState()
      .syncFromSnapshot(createSnapshot({ backgroundColor: '#FF0000' }));

    const after = useSettingsStore.getState();
    expect(after.backgroundColor).toBe('#FF0000');
    expect(after.noteSettings).toBe(before.noteSettings);
    expect(after.gridSettings).toBe(before.gridSettings);
  });

  it('객체 필드 변경 시 해당 필드만 교체한다', () => {
    const before = useSettingsStore.getState();
    const nextNote = { ...getDefaultNoteSettings(), trackHeight: 999 };

    useSettingsStore
      .getState()
      .syncFromSnapshot(createSnapshot({ noteSettings: nextNote }));

    const after = useSettingsStore.getState();
    expect(after.noteSettings.trackHeight).toBe(999);
    expect(after.noteSettings).not.toBe(before.noteSettings);
    expect(after.gridSettings).toBe(before.gridSettings);
    expect(after.shortcuts).toBe(before.shortcuts);
  });

  it('로컬에서 변경된 필드를 스냅샷 값으로 되돌린다', () => {
    useSettingsStore.setState({ backgroundColor: '#123456' });

    useSettingsStore.getState().syncFromSnapshot(createSnapshot());

    expect(useSettingsStore.getState().backgroundColor).toBe('#000000');
  });

  it('키 순서만 다른 동일 내용은 무변경으로 취급한다', () => {
    const overridesAB = {
      '4key': { trackHeight: 500 },
      '5key': { trackHeight: 600 },
    };
    const overridesBA = {
      '5key': { trackHeight: 600 },
      '4key': { trackHeight: 500 },
    };
    useSettingsStore
      .getState()
      .setAll(createSnapshot({ tabNoteOverrides: overridesAB }));
    const before = useSettingsStore.getState();

    useSettingsStore
      .getState()
      .syncFromSnapshot(createSnapshot({ tabNoteOverrides: overridesBA }));

    expect(useSettingsStore.getState().tabNoteOverrides).toBe(
      before.tabNoteOverrides,
    );
  });

  it('tabNoteOverrides 변경을 원자적으로 적용한다', () => {
    const before = useSettingsStore.getState();
    const overrides = {
      '4key': { trackHeight: 500 },
    };

    useSettingsStore
      .getState()
      .syncFromSnapshot(createSnapshot({ tabNoteOverrides: overrides }));

    const after = useSettingsStore.getState();
    expect(after.tabNoteOverrides).toEqual(overrides);
    expect(after.noteSettings).toBe(before.noteSettings);
  });
});
