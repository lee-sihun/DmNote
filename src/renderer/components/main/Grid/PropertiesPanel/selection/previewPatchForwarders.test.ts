import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  composePreviewPositions,
  previewOverlay,
} from '@src/renderer/editor/runtime/gesture/previewOverlay';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

import {
  previewBatchGraphColor,
  previewBatchPaint,
  previewBatchStyleProperty,
  previewSingleStyleProperty,
} from './previewPatchForwarders';

const KEY_ID = '00000000-0000-4000-8000-000000000501';
const KNOB_ID = '00000000-0000-4000-8000-000000000502';
const KEY_ID_A = '00000000-0000-4000-8000-000000000511';
const KEY_ID_B = '00000000-0000-4000-8000-000000000512';
const KEY_ID_C = '00000000-0000-4000-8000-000000000513';

vi.mock('@api/modules/editor/previewApi', () => ({
  previewApi: {
    subscribe: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock(
  '@src/renderer/editor/runtime/coordinator/editorStateCoordinator',
  () => ({
    editorCoordinator: {
      commitPatch: vi.fn().mockResolvedValue(undefined),
      commitGeneratedPatch: vi.fn(),
      runExclusiveLegacyMutation: vi.fn(
        async (mutation: () => Promise<unknown>) => mutation(),
      ),
      getState: () => ({ revision: null }),
    },
    // 프로덕션과 동일하게 canonical 스토어를 문서로 캡처
    captureEditorDocument: () => ({
      schemaVersion: 1,
      keys: {},
      keyPositions: useKeyStore.getState().canonicalPositions,
      statPositions: useStatItemStore.getState().positions,
      graphPositions: useGraphItemStore.getState().positions,
      knobPositions: useKnobItemStore.getState().positions,
    }),
  }),
);

const keyFixture = (): CanonicalEditorDocumentV1['keyPositions'] =>
  ({
    '4key': [
      {
        ...createDefaultKeyPosition(),
        id: KEY_ID,
        fontColor: '#old-idle',
        backgroundColor: '#old-background',
        activeBackgroundColor: undefined,
        borderWidth: 1,
        noteOffsetX: 42,
      },
    ],
  } as CanonicalEditorDocumentV1['keyPositions']);

const knobFixture = (): CanonicalEditorDocumentV1['knobPositions'] =>
  ({
    '4key': [
      {
        ...createDefaultKeyPosition(),
        id: KNOB_ID,
        axisId: 'HIDA:test',
        sensitivity: 1,
        reverse: false,
      },
    ],
  } as CanonicalEditorDocumentV1['knobPositions']);

const composedKey = () =>
  composePreviewPositions(
    'keyPosition',
    useKeyStore.getState().canonicalPositions,
  )['4key'][0] as Record<string, unknown>;

const composedKnob = () =>
  composePreviewPositions(
    'knobPosition',
    useKnobItemStore.getState().positions,
  )['4key'][0] as Record<string, unknown>;

const composedGraph = () =>
  composePreviewPositions(
    'graphPosition',
    useGraphItemStore.getState().positions,
  )['4key'][0] as Record<string, unknown>;

// 태그 patch가 원본 그대로 스프레드되면 위치 객체에 property/value
// 리터럴 키가 생기고 실제 필드는 바뀌지 않는다 - 그 오염을 여기서 고정한다
const expectNoWirePollution = (position: Record<string, unknown>) => {
  expect(Object.keys(position)).not.toContain('property');
  expect(Object.keys(position)).not.toContain('value');
};

describe('preview patch forwarders (forwarder → overlay 실경로)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewOverlay.clearAll();
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: keyFixture(),
      positions: keyFixture(),
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: knobFixture() });
  });

  afterEach(() => {
    editGestureController.cancel();
    previewOverlay.clearAll();
  });

  it('single style 태그 patch는 위치 조각으로 투영되고 wire 키를 남기지 않는다', () => {
    previewSingleStyleProperty('key', KEY_ID, {
      property: 'borderWidth',
      value: 12.5,
    });

    const composed = composedKey();
    expect(composed.borderWidth).toBe(12.5);
    expectNoWirePollution(composed);
    // canonical은 불가침
    expect(
      (useKeyStore.getState().canonicalPositions['4key'][0] as KeyRecord)
        .borderWidth,
    ).toBe(1);
  });

  it('single style nullable leaf의 null은 undefined 위치 조각으로 투영된다', () => {
    previewSingleStyleProperty('key', KEY_ID, {
      property: 'noteOffsetX',
      value: null,
    });

    const composed = composedKey();
    expect(composed.noteOffsetX).toBeUndefined();
    expectNoWirePollution(composed);
  });

  it('batch style 태그 patch는 타입별 도메인 전부에 깨끗하게 투영된다', () => {
    previewBatchStyleProperty(
      [
        { elementType: 'key', id: KEY_ID },
        { elementType: 'knob', id: KNOB_ID },
      ],
      '4key',
      { property: 'fontSize', value: 31.5 },
    );

    const key = composedKey();
    const knob = composedKnob();
    expect(key.fontSize).toBe(31.5);
    expect(knob.fontSize).toBe(31.5);
    expectNoWirePollution(key);
    expectNoWirePollution(knob);
  });

  it('batch shadow leaf는 대상별 현재 스펙에 얹혀 전체 스펙으로 투영된다', () => {
    const seeded = keyFixture();
    (seeded['4key'][0] as KeyRecord).shadow = {
      enabled: true,
      color: '#123456',
      offsetX: 1,
      offsetY: 2,
      blur: 3,
    };
    useKeyStore.setState({ canonicalPositions: seeded, positions: seeded });

    previewBatchStyleProperty(
      [
        { elementType: 'key', id: KEY_ID },
        { elementType: 'knob', id: KNOB_ID },
      ],
      '4key',
      { property: 'shadow', value: { leaf: 'offsetX', value: 7 } },
    );

    // 키는 자기 색·blur를 유지한 채 offsetX만 바뀐다
    const key = composedKey();
    expect(key.shadow).toEqual({
      enabled: true,
      color: '#123456',
      offsetX: 7,
      offsetY: 2,
      blur: 3,
    });
    // 저장된 그림자가 없는 노브는 기본 스펙 위에 얹힌다
    const knob = composedKnob();
    expect((knob.shadow as KeyRecord).offsetX).toBe(7);
    expect((knob.shadow as KeyRecord).enabled).toBeDefined();
    expectNoWirePollution(key);
    expectNoWirePollution(knob);
  });

  it('batch activeShadow leaf는 통계를 건너뛴다', () => {
    const STAT_ID = '00000000-0000-4000-8000-000000000521';
    useStatItemStore.setState({
      positions: {
        '4key': [
          { ...createDefaultKeyPosition(), id: STAT_ID, statType: 'kps' },
        ],
      } as CanonicalEditorDocumentV1['statPositions'],
    });

    previewBatchStyleProperty(
      [
        { elementType: 'key', id: KEY_ID },
        { elementType: 'stat', id: STAT_ID },
      ],
      '4key',
      { property: 'activeShadow', value: { leaf: 'blur', value: 9 } },
    );

    expect((composedKey().activeShadow as KeyRecord).blur).toBe(9);
    const stat = composePreviewPositions(
      'statPosition',
      useStatItemStore.getState().positions,
    )['4key'][0] as KeyRecord;
    expect(stat.activeShadow).toBeUndefined();
  });

  it('batch font paint는 commit eager와 같은 투영으로 active fallback까지 포함한다', () => {
    previewBatchPaint([{ elementType: 'key', id: KEY_ID }], '4key', {
      property: 'fontPaint',
      value: { color: '#new-idle', gradient: null },
    });

    const composed = composedKey();
    expect(composed.fontColor).toBe('#new-idle');
    // idle만 바꿀 때 비어 있던 active는 기존 idle로 보존 (commit eager와 동일)
    expect(composed.activeFontColor).toBe('#old-idle');
    expectNoWirePollution(composed);
  });

  it('batch active font paint는 active 조각만 투영된다', () => {
    previewBatchPaint([{ elementType: 'key', id: KEY_ID }], '4key', {
      property: 'activeFontPaint',
      value: { color: '#new-active', gradient: null },
    });

    const composed = composedKey();
    expect(composed.activeFontColor).toBe('#new-active');
    expect(composed.fontColor).toBe('#old-idle');
    expectNoWirePollution(composed);
  });

  it('batch paint는 commit과 같은 projection으로 idle fallback까지 투영한다', () => {
    previewBatchPaint([{ elementType: 'key', id: KEY_ID }], '4key', {
      property: 'backgroundPaint',
      value: { color: '#new-background', gradient: null },
    });

    const composed = composedKey();
    expect(composed.backgroundColor).toBe('#new-background');
    expect(composed.backgroundGradient).toBeUndefined();
    expect(composed.activeBackgroundColor).toBe('#old-background');
    expectNoWirePollution(composed);
  });

  it('batch graph color는 graphPosition preview에만 투영한다', () => {
    useGraphItemStore.setState({
      positions: {
        '4key': [
          {
            ...createDefaultKeyPosition(),
            id: KEY_ID_A,
            graphColor: '#old-graph',
          },
        ],
      } as never,
    });

    previewBatchGraphColor([KEY_ID_A], '4key', '#new-graph');

    expect(composedGraph().graphColor).toBe('#new-graph');
    expectNoWirePollution(composedGraph());
  });

  it('배치 프리뷰 중 비대상 삭제로 index가 밀려도 요소별 patch가 제 요소에 누적된다', () => {
    // [C, A, B] - A·B만 선택, idle 색이 달라 active fallback이 요소별 상이값
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: {
        '4key': [
          { ...createDefaultKeyPosition(), id: KEY_ID_C, fontColor: '#c-idle' },
          { ...createDefaultKeyPosition(), id: KEY_ID_A, fontColor: '#a-idle' },
          { ...createDefaultKeyPosition(), id: KEY_ID_B, fontColor: '#b-idle' },
        ],
      } as CanonicalEditorDocumentV1['keyPositions'],
      positions: {
        '4key': [
          { ...createDefaultKeyPosition(), id: KEY_ID_C, fontColor: '#c-idle' },
          { ...createDefaultKeyPosition(), id: KEY_ID_A, fontColor: '#a-idle' },
          { ...createDefaultKeyPosition(), id: KEY_ID_B, fontColor: '#b-idle' },
        ],
      } as CanonicalEditorDocumentV1['keyPositions'],
    });
    const targets = [
      { elementType: 'key' as const, id: KEY_ID_A },
      { elementType: 'key' as const, id: KEY_ID_B },
    ];

    previewBatchPaint(targets, '4key', {
      property: 'fontPaint',
      value: { color: '#new-1', gradient: null },
    });

    // 게스처와 미배타인 격리 커밋이 비선택 C를 삭제 - A·B live index가 당겨진다
    const [, ...rest] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.getState().setPositions({
      '4key': rest,
    } as CanonicalEditorDocumentV1['keyPositions']);

    // 드래그 계속 - forwarder가 live index를 재해석해 전달하는 두 번째 이벤트
    previewBatchPaint(targets, '4key', {
      property: 'fontPaint',
      value: { color: '#new-2', gradient: null },
    });

    const rendered = composePreviewPositions(
      'keyPosition',
      useKeyStore.getState().canonicalPositions,
    )['4key'] as Array<Record<string, unknown>>;
    // 요소별 상이값(active fallback)이 제 요소에 유지 - B의 patch가 A를 덮지 않는다
    expect(rendered[0]).toMatchObject({
      id: KEY_ID_A,
      fontColor: '#new-2',
      activeFontColor: '#a-idle',
    });
    expect(rendered[1]).toMatchObject({
      id: KEY_ID_B,
      fontColor: '#new-2',
      activeFontColor: '#b-idle',
    });
  });
});

type KeyRecord = Record<string, unknown>;
