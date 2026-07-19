import { describe, expect, it, vi } from 'vitest';
import { useBatchHandlers } from '@components/main/Grid/PropertiesPanel/batch/useBatchHandlers';
import type { KeyPosition } from '@src/types/key/keys';
import { normalizeCounterSettings } from '@src/types/key/keys';
import type { GradientSpec } from '@src/types/color';

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: vi.fn().mockResolvedValue(undefined) },
}));

const position = (
  color: string,
  overrides: Partial<KeyPosition> = {},
): KeyPosition =>
  ({
    dx: 0,
    dy: 0,
    width: 60,
    height: 60,
    count: 0,
    shadow: {
      enabled: true,
      color,
      offsetX: 0,
      offsetY: 4,
      blur: 10,
    },
    ...overrides,
  } as KeyPosition);

describe('배치 그림자 부분 변경', () => {
  it('바꾼 항목만 합치고 요소별 기존 색상은 보존한다', () => {
    const onKeyBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', index: 0 },
        { type: 'key', index: 1 },
      ],
      keyPositions: {
        '4key': [position('#111111'), position('#eeeeee')],
      },
      statPositions: {},
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
    });

    handlers.handleBatchShadowChangeComplete('idle', { blur: 24 });

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [
        {
          index: 0,
          shadow: {
            enabled: true,
            color: '#111111',
            offsetX: 0,
            offsetY: 4,
            blur: 24,
          },
        },
        {
          index: 1,
          shadow: {
            enabled: true,
            color: '#eeeeee',
            offsetX: 0,
            offsetY: 4,
            blur: 24,
          },
        },
      ],
      { skipHistory: false, deferSave: true },
    );
  });

  it('마스터 토글이 요소별 값을 보존하며 대기·입력을 함께 끈다', () => {
    const onKeyBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [{ type: 'key', index: 0 }],
      keyPositions: {
        '4key': [position('#111111')],
      },
      statPositions: {},
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
    });

    handlers.handleBatchShadowEnabledChange(false);

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [
        {
          index: 0,
          shadow: {
            enabled: false,
            color: '#111111',
            offsetX: 0,
            offsetY: 4,
            blur: 10,
          },
          // 저장된 activeShadow가 없으면 기본 입력 그림자 기준으로 끔
          activeShadow: {
            enabled: false,
            color: 'rgba(0, 0, 0, 0.32)',
            offsetX: 0,
            offsetY: 3,
            blur: 8,
          },
        },
      ],
      { skipHistory: false, deferSave: true },
    );
  });
});

describe('통계 그림자 — 눌림 상태 없음', () => {
  const statHandlerArgs = () => {
    const onStatBatchUpdate = vi.fn();
    return {
      onStatBatchUpdate,
      args: {
        selectedKeyLikeElements: [{ type: 'stat' as const, index: 0 }],
        keyPositions: {},
        statPositions: {
          '4key': [{ ...position('#111111'), statType: 'kps' as const }],
        },
        selectedKeyType: '4key',
        onKeyUpdate: vi.fn(),
        onKeyBatchUpdate: vi.fn(),
        onStatUpdate: vi.fn(),
        onStatBatchUpdate,
      },
    };
  };

  it('입력 상태 패치는 통계에 기록되지 않는다', () => {
    const { args, onStatBatchUpdate } = statHandlerArgs();
    const handlers = useBatchHandlers(args);
    handlers.handleBatchShadowChangeComplete('active', { blur: 24 });
    expect(onStatBatchUpdate).toHaveBeenCalledWith([{ index: 0 }], {
      skipHistory: false,
      deferSave: true,
    });
  });

  it('마스터 토글은 통계에 shadow만 기록한다', () => {
    const { args, onStatBatchUpdate } = statHandlerArgs();
    const handlers = useBatchHandlers(args);
    handlers.handleBatchShadowEnabledChange(false);
    const [updates] = onStatBatchUpdate.mock.calls[0];
    expect(updates[0].shadow.enabled).toBe(false);
    expect(updates[0]).not.toHaveProperty('activeShadow');
  });
});

describe('눌림 가능(키·노브) active 쓰기', () => {
  it('activeCapable 쓰기가 키·노브에 전달되고 통계는 제외된다', () => {
    const onKeyBatchUpdate = vi.fn();
    const onKnobBatchUpdate = vi.fn();
    const onStatBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', index: 0 },
        { type: 'knob', index: 0 },
        { type: 'stat', index: 0 },
      ],
      keyPositions: { '4key': [position('#111111')] },
      statPositions: {
        '4key': [{ ...position('#111111'), statType: 'kps' as const }],
      },
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
      onStatBatchUpdate,
      onKnobBatchUpdate,
    });

    handlers.handleActiveCapableStyleChangeComplete('activeImage', 'img.svg');

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [{ index: 0, activeImage: 'img.svg' }],
      expect.anything(),
    );
    expect(onKnobBatchUpdate).toHaveBeenCalledWith(
      [{ index: 0, activeImage: 'img.svg' }],
      expect.anything(),
    );
    // 통계에는 active 필드가 기록되지 않음
    for (const call of onStatBatchUpdate.mock.calls) {
      for (const update of call[0]) {
        expect(update).not.toHaveProperty('activeImage');
      }
    }
  });
});

describe('입력 그라데이션 커밋 대상', () => {
  it('active 커밋은 키·노브만 — 통계·그래프 제외', () => {
    const onKeyBatchUpdate = vi.fn();
    const onGraphBatchUpdate = vi.fn();
    const onStatBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', index: 0 },
        { type: 'stat', index: 0 },
        { type: 'graph', index: 0 },
      ],
      keyPositions: { '4key': [position('#111111')] },
      statPositions: {
        '4key': [{ ...position('#111111'), statType: 'kps' as const }],
      },
      graphPositions: {
        '4key': [
          {
            ...position('#111111'),
            statType: 'kps' as const,
            graphType: 'line' as const,
            graphSpeed: 1,
            graphColor: '#ffffff',
          },
        ],
      },
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
      onStatBatchUpdate,
      onGraphBatchUpdate,
    });

    handlers.handleBatchGradientCommit('backgroundColor', 'active', {
      mode: 'solid',
      color: '#abcdef',
    });

    expect(onKeyBatchUpdate).toHaveBeenCalled();
    expect(onGraphBatchUpdate).not.toHaveBeenCalled();
    expect(onStatBatchUpdate).not.toHaveBeenCalled();
  });
});

describe('배치 색 상태 쌍 보존', () => {
  const useTestHandlers = (keyPosition: KeyPosition) => {
    const onKeyBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [{ type: 'key', index: 0 }],
      keyPositions: { '4key': [keyPosition] },
      statPositions: {},
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
    });
    return { handlers, onKeyBatchUpdate };
  };

  it('저장된 idle 단색이 없으면 active 기본값을 실체화하지 않는다', () => {
    const { handlers, onKeyBatchUpdate } = useTestHandlers(position('#111111'));

    handlers.handleBatchStyleChangeComplete('backgroundColor', '#abcdef');

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [{ index: 0, backgroundColor: '#abcdef' }],
      { skipHistory: false, deferSave: true },
    );
  });

  it('저장된 idle 단색은 active가 비어 있을 때 동결한다', () => {
    const { handlers, onKeyBatchUpdate } = useTestHandlers(
      position('#111111', { backgroundColor: '#123456' }),
    );

    handlers.handleBatchStyleChangeComplete('backgroundColor', '#abcdef');

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [
        {
          index: 0,
          backgroundColor: '#abcdef',
          activeBackgroundColor: '#123456',
        },
      ],
      { skipHistory: false, deferSave: true },
    );
  });

  it('저장된 idle 그라데이션이 없으면 active 쌍을 실체화하지 않는다', () => {
    const { handlers, onKeyBatchUpdate } = useTestHandlers(position('#111111'));

    handlers.handleBatchGradientCommit('backgroundColor', 'idle', {
      mode: 'solid',
      color: '#abcdef',
    });

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [
        {
          index: 0,
          backgroundColor: '#abcdef',
          backgroundGradient: undefined,
        },
      ],
      { skipHistory: false, deferSave: true },
    );
  });

  it('저장된 idle 그라데이션 쌍은 active가 비어 있을 때 동결한다', () => {
    const gradient: GradientSpec = {
      angle: 45,
      stops: [
        { color: '#123456', pos: 0 },
        { color: '#654321', pos: 1 },
      ],
    };
    const { handlers, onKeyBatchUpdate } = useTestHandlers(
      position('#111111', {
        backgroundColor: '#123456',
        backgroundGradient: gradient,
      }),
    );

    handlers.handleBatchGradientCommit('backgroundColor', 'idle', {
      mode: 'solid',
      color: '#abcdef',
    });

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [
        {
          index: 0,
          backgroundColor: '#abcdef',
          backgroundGradient: undefined,
          activeBackgroundColor: '#123456',
          activeBackgroundGradient: gradient,
        },
      ],
      { skipHistory: false, deferSave: true },
    );
  });
});

describe('통계 active 스타일 쓰기 차단', () => {
  const useMixedHandlerArgs = () => {
    const onKeyBatchUpdate = vi.fn();
    const onStatBatchUpdate = vi.fn();
    const keyCounter = normalizeCounterSettings(undefined);
    keyCounter.fill.active = '#121212';
    const statCounter = normalizeCounterSettings(undefined);
    statCounter.fill.active = '#343434';
    return {
      keyCounter,
      statCounter,
      onKeyBatchUpdate,
      onStatBatchUpdate,
      handlers: useBatchHandlers({
        selectedKeyLikeElements: [
          { type: 'key', index: 0 },
          { type: 'stat', index: 0 },
        ],
        keyPositions: {
          '4key': [position('#111111', { counter: keyCounter })],
        },
        statPositions: {
          '4key': [
            {
              ...position('#222222', {
                backgroundColor: '#333333',
                counter: statCounter,
              }),
              statType: 'kps' as const,
            },
          ],
        },
        selectedKeyType: '4key',
        onKeyUpdate: vi.fn(),
        onKeyBatchUpdate,
        onStatUpdate: vi.fn(),
        onStatBatchUpdate,
      }),
    };
  };

  it('active 색과 그라데이션은 통계 업데이트에서 제외한다', () => {
    const { handlers, onKeyBatchUpdate, onStatBatchUpdate } =
      useMixedHandlerArgs();

    handlers.handleBatchStyleChangeComplete('activeBackgroundColor', '#abcdef');
    handlers.handleBatchGradientCommit('backgroundColor', 'active', {
      mode: 'solid',
      color: '#fedcba',
    });

    expect(onKeyBatchUpdate).toHaveBeenCalledTimes(2);
    expect(onStatBatchUpdate).not.toHaveBeenCalled();
  });

  it('통계 idle 색 변경은 active 쌍을 새로 기록하지 않는다', () => {
    const { handlers, onStatBatchUpdate } = useMixedHandlerArgs();

    handlers.handleBatchStyleChangeComplete('backgroundColor', '#abcdef');

    const [updates] = onStatBatchUpdate.mock.calls[0];
    expect(updates).toEqual([{ index: 0, backgroundColor: '#abcdef' }]);
    expect(updates[0]).not.toHaveProperty('activeBackgroundColor');
  });

  it('active 카운터 색은 혼합 선택의 키에만 기록한다', () => {
    const { handlers, keyCounter, onKeyBatchUpdate, onStatBatchUpdate } =
      useMixedHandlerArgs();

    handlers.handleBatchCounterUpdate(
      {
        fill: { ...keyCounter.fill, active: '#abcdef' },
      },
      { activeStateOnly: true, colorState: 'active' },
    );

    const [updates] = onKeyBatchUpdate.mock.calls[0];
    expect(updates[0].counter.fill.active).toBe('#abcdef');
    expect(onStatBatchUpdate).not.toHaveBeenCalled();
  });

  it('idle 카운터 색은 요소별 기존 active 쌍을 보존한다', () => {
    const {
      handlers,
      keyCounter,
      statCounter,
      onKeyBatchUpdate,
      onStatBatchUpdate,
    } = useMixedHandlerArgs();

    handlers.handleBatchCounterUpdate(
      {
        fill: { idle: '#abcdef', active: '#ffffff' },
      },
      { colorState: 'idle' },
    );

    const [keyUpdates] = onKeyBatchUpdate.mock.calls[0];
    const [statUpdates] = onStatBatchUpdate.mock.calls[0];
    expect(keyUpdates[0].counter.fill).toEqual({
      idle: '#abcdef',
      active: keyCounter.fill.active,
    });
    expect(statUpdates[0].counter.fill).toEqual({
      idle: '#abcdef',
      active: statCounter.fill.active,
    });
  });
});
