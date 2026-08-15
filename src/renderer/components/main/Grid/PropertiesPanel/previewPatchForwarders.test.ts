import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  composePreviewPositions,
  previewOverlay,
} from '@src/renderer/editor/runtime/previewOverlay';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';

import {
  previewBatchFontColor,
  previewBatchStyleProperty,
  previewSingleStyleProperty,
} from './previewPatchForwarders';

const KEY_ID = '00000000-0000-4000-8000-000000000501';
const KNOB_ID = '00000000-0000-4000-8000-000000000502';

vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    subscribe: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
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
}));

const keyFixture = (): CanonicalEditorDocumentV1['keyPositions'] =>
  ({
    '4key': [
      {
        ...createDefaultKeyPosition(),
        id: KEY_ID,
        fontColor: '#old-idle',
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

  it('batch font color는 projectFontColorPatch를 거쳐 active fallback까지 투영된다', () => {
    previewBatchFontColor([{ elementType: 'key', id: KEY_ID }], '4key', {
      property: 'fontColor',
      value: '#new-idle',
    });

    const composed = composedKey();
    expect(composed.fontColor).toBe('#new-idle');
    // idle만 바꿀 때 비어 있던 active는 기존 idle로 보존 (commit eager와 동일)
    expect(composed.activeFontColor).toBe('#old-idle');
    expectNoWirePollution(composed);
  });

  it('batch active font color는 activeFontColor 조각만 투영된다', () => {
    previewBatchFontColor([{ elementType: 'key', id: KEY_ID }], '4key', {
      property: 'activeFontColor',
      value: '#new-active',
    });

    const composed = composedKey();
    expect(composed.activeFontColor).toBe('#new-active');
    expect(composed.fontColor).toBe('#old-idle');
    expectNoWirePollution(composed);
  });
});

type KeyRecord = Record<string, unknown>;
