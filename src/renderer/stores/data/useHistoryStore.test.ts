import { beforeEach, describe, expect, it } from 'vitest';
import {
  useHistoryStore,
  type HistorySettingsSnapshot,
} from '@stores/data/useHistoryStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  applyCounterCacheSnapshot,
  setCachedKeyCounter,
} from '@stores/signals/keyCounterCache';
import {
  getDefaultCounterSettings,
  getDefaultNoteSettings,
} from '@src/renderer/defaults';
import type {
  CustomTab,
  KeyCounters,
  KeyMappings,
  KeyPositions,
} from '@src/types/key/keys';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { DialItemPositions } from '@src/types/key/dials';
import { useDialItemStore } from '@stores/data/useDialItemStore';

const createMappings = (key: string): KeyMappings => ({
  '4key': [key],
});

const createPositions = (count: number): KeyPositions => ({
  '4key': [
    {
      dx: count,
      dy: 0,
      width: 100,
      height: 100,
      hidden: false,
      count,
      noteColor: '#FFFFFF',
      noteOpacity: 80,
      noteAlignment: 'center',
      noteEffectEnabled: true,
      noteGlowEnabled: false,
      noteGlowSize: 20,
      noteGlowOpacity: 70,
      noteAutoYCorrection: true,
      counter: getDefaultCounterSettings(),
    },
  ],
});

const createDials = (rotationDeg: number): DialItemPositions => ({
  '4key': [
    {
      ...createPositions(1)['4key'][0],
      axisId: 'HIDA:1:2:1:48',
      sensitivity: rotationDeg,
      reverse: false,
    },
  ],
});

const EMPTY_STATS: StatItemPositions = {};
const EMPTY_GRAPHS: GraphItemPositions = {};
const EMPTY_DIALS: DialItemPositions = {};
const DEFAULT_TABS: CustomTab[] = [{ id: 'tab-1', name: 'Tab 1' }];

const resetStores = () => {
  useHistoryStore.setState({ past: [], future: [] });
  useKeyStore.setState({
    selectedKeyType: '4key',
    customTabs: DEFAULT_TABS,
    keyMappings: createMappings('A'),
    positions: createPositions(1),
    isBootstrapped: true,
    isLocalUpdateInProgress: false,
  });
  useDialItemStore.setState({ positions: {} });
  applyCounterCacheSnapshot({});
};

describe('useHistoryStore', () => {
  beforeEach(() => {
    resetStores();
  });

  it('pushState는 현재 카운터 캐시 스냅샷을 즉시 저장', () => {
    applyCounterCacheSnapshot({ '4key': { A: 3 } });

    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    setCachedKeyCounter('4key', 'A', 9);

    const history = useHistoryStore.getState().past;
    expect(history).toHaveLength(1);
    expect(history[0]?.keyCounters).toEqual({ '4key': { A: 3 } });
  });

  it('undo는 현재 카운터 캐시를 future에 저장하고 이전 스냅샷을 반환', () => {
    applyCounterCacheSnapshot({ '4key': { A: 2 } });
    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    useKeyStore.setState({
      keyMappings: createMappings('B'),
      positions: createPositions(2),
    });
    applyCounterCacheSnapshot({ '4key': { A: 7 } });

    const restored = useHistoryStore.getState().undo({
      keyMappings: createMappings('B'),
      positions: createPositions(2),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    expect(restored?.keyMappings).toEqual(createMappings('A'));
    expect(restored?.positions).toEqual(createPositions(1));
    expect(restored?.keyCounters).toEqual({ '4key': { A: 2 } });

    const future = useHistoryStore.getState().future;
    expect(future).toHaveLength(1);
    expect(future[0]?.keyMappings).toEqual(createMappings('B'));
    expect(future[0]?.positions).toEqual(createPositions(2));
    expect(future[0]?.keyCounters).toEqual({ '4key': { A: 7 } });
  });

  it('redo는 future의 스냅샷을 복원하고 현재 카운터 캐시를 past에 저장', () => {
    const historyStore = useHistoryStore.getState();
    historyStore.clear();

    historyStore.pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
      keyCounters: { '4key': { A: 2 } },
    });

    useKeyStore.setState({
      keyMappings: createMappings('B'),
      positions: createPositions(2),
    });
    applyCounterCacheSnapshot({ '4key': { A: 7 } });
    historyStore.undo({
      keyMappings: createMappings('B'),
      positions: createPositions(2),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    useKeyStore.setState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
    });
    applyCounterCacheSnapshot({ '4key': { A: 4 } });

    const restored = useHistoryStore.getState().redo({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    expect(restored?.keyMappings).toEqual(createMappings('B'));
    expect(restored?.positions).toEqual(createPositions(2));
    expect(restored?.keyCounters).toEqual({ '4key': { A: 7 } });

    const past = useHistoryStore.getState().past;
    expect(past).toHaveLength(1);
    expect(past[0]?.keyMappings).toEqual(createMappings('A'));
    expect(past[0]?.keyCounters).toEqual({ '4key': { A: 4 } });
  });

  it('settingsSnapshot이 있으면 pushState에서 저장되고 undo에서 복원', () => {
    const snap: HistorySettingsSnapshot = {
      useCustomCSS: true,
      customCSSContent: 'body { color: red; }',
      customCSSPath: null,
      useCustomJS: false,
      jsPlugins: [],
      fontSettings: { customFonts: [] },
      backgroundColor: '#000000',
      noteSettings: getDefaultNoteSettings(),
      noteEffect: true,
      tabNoteOverrides: { 'tab-custom': { speed: 10 } },
    };

    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
      settingsSnapshot: snap,
    });

    expect(useHistoryStore.getState().past[0]?.settingsSnapshot).toEqual(snap);

    const restored = useHistoryStore.getState().undo({
      keyMappings: createMappings('B'),
      positions: createPositions(2),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    expect(restored?.settingsSnapshot).toEqual(snap);
  });

  it('settingsSnapshot 없이 pushState하면 undefined', () => {
    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    expect(
      useHistoryStore.getState().past[0]?.settingsSnapshot,
    ).toBeUndefined();
  });

  it('명시적 keyCounters가 있으면 캐시 대신 그 값을 저장', () => {
    applyCounterCacheSnapshot({ '4key': { A: 1 } });

    const providedCounters: KeyCounters = { '4key': { A: 99 } };

    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
      keyCounters: providedCounters,
    });

    expect(useHistoryStore.getState().past[0]?.keyCounters).toEqual(
      providedCounters,
    );
  });

  it('명시적 dialPositions가 있으면 그대로 저장', () => {
    const dials = createDials(360);

    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
      dialPositions: dials,
    });

    expect(useHistoryStore.getState().past[0]?.dialPositions).toEqual(dials);
  });

  it('dialPositions 미제공 시 현재 dial store에서 자동 캡처', () => {
    useDialItemStore.setState({ positions: createDials(180) });

    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
    });

    expect(useHistoryStore.getState().past[0]?.dialPositions).toEqual(
      createDials(180),
    );
  });

  it('undo는 이전 dialPositions 스냅샷을 반환하고 현재 dial을 future에 저장', () => {
    useHistoryStore.getState().pushState({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
      dialPositions: createDials(90),
    });

    const restored = useHistoryStore.getState().undo({
      keyMappings: createMappings('A'),
      positions: createPositions(1),
      statPositions: EMPTY_STATS,
      graphPositions: EMPTY_GRAPHS,
      dialPositions: createDials(270),
    });

    expect(restored?.dialPositions).toEqual(createDials(90));
    expect(useHistoryStore.getState().future[0]?.dialPositions).toEqual(
      createDials(270),
    );
  });
});
