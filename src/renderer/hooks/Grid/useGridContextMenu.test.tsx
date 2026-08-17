/**
 * 키 컨텍스트 메뉴 예측자 context 재해석 테스트
 * 열림 시점 index가 아니라 요소 id로 현재 배열에서 재해석하는지 검증
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useGridContextMenu } from '@hooks/Grid/useGridContextMenu';
import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type { KeyMappings, KeyPosition } from '@src/types/key/keys';
import type {
  KeyMenuContext,
  PluginMenuItemInternal,
} from '@src/types/plugin/api';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ID_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

const keyPos = (id: string): KeyPosition => ({
  ...createDefaultKeyPosition(),
  id,
});

interface ProbeProps {
  positions: Record<string, KeyPosition[]>;
  keyMappings: KeyMappings;
}

// 렌더 결과 캡처 - act가 effect까지 flush하므로 호출 시점엔 항상 최신
const captured: { current: ReturnType<typeof useGridContextMenu> | null } = {
  current: null,
};
const latest = () => captured.current!;

const Probe = ({ positions, keyMappings }: ProbeProps) => {
  const result = useGridContextMenu({
    selectedKeyType: '4key',
    keyMappings,
    positions,
    locale: 'ko',
    t: (key) => key,
    noteEffect: false,
  });
  useEffect(() => {
    captured.current = result;
  });
  return null;
};

describe('키 메뉴 예측자 context 재해석', () => {
  let container: HTMLDivElement;
  let root: Root;
  let seenContexts: KeyMenuContext[];

  const seedMenuItem = () => {
    seenContexts = [];
    const item: PluginMenuItemInternal<KeyMenuContext> = {
      id: 'inspect',
      fullId: 'pluginA::inspect',
      pluginId: 'pluginA',
      label: 'menu.inspect',
      position: 'top',
      visible: (context) => {
        seenContexts.push(context);
        return true;
      },
      disabled: (context) => context.keyCode !== 'A',
      onClick: () => {},
    };
    usePluginMenuStore.setState({
      keyMenuItems: [item as PluginMenuItemInternal<KeyMenuContext>],
      gridMenuItems: [],
    });
  };

  const renderProbe = (props: ProbeProps) => {
    act(() => {
      root.render(<Probe {...props} />);
    });
  };

  beforeEach(() => {
    seedMenuItem();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    usePluginMenuStore.setState({ keyMenuItems: [], gridMenuItems: [] });
  });

  it('열림 중 재정렬돼도 예측자 context가 원래 요소를 따라간다', () => {
    renderProbe({
      positions: { '4key': [keyPos(ID_1), keyPos(ID_2)] },
      keyMappings: { '4key': ['A', 'B'] },
    });

    // 열림 시점: index 0 = ID_1
    const items = latest().getKeyMenuItems(0, ID_1);
    expect(items.some((item) => item.id === 'pluginA::inspect')).toBe(true);
    expect(seenContexts.at(-1)).toMatchObject({
      id: ID_1,
      index: 0,
      keyCode: 'A',
    });

    // 재정렬 리렌더 - 동결된 index 0은 이제 다른 요소를 가리킨다
    renderProbe({
      positions: { '4key': [keyPos(ID_2), keyPos(ID_1)] },
      keyMappings: { '4key': ['B', 'A'] },
    });

    const reordered = latest().getKeyMenuItems(0, ID_1);
    const pluginItem = reordered.find(
      (item) => item.id === 'pluginA::inspect',
    )!;
    // id로 재해석되어 원래 요소(ID_1) 기준으로 평가된다
    expect(seenContexts.at(-1)).toMatchObject({
      id: ID_1,
      index: 1,
      keyCode: 'A',
    });
    expect(pluginItem.disabled).toBe(false);
  });

  it('요소 소실 시 플러그인 항목을 감춰 fail-closed로 동작한다', () => {
    renderProbe({
      positions: { '4key': [keyPos(ID_2)] },
      keyMappings: { '4key': ['B'] },
    });

    const items = latest().getKeyMenuItems(0, ID_1);
    // 예측자 미평가 + 플러그인 항목 제외, 기본 항목은 유지
    expect(seenContexts).toHaveLength(0);
    expect(items.some((item) => item.isPlugin)).toBe(false);
    expect(items.map((item) => item.id)).toEqual([
      'delete',
      'duplicate',
      'counterReset',
      'bringToFront',
      'sendToBack',
    ]);
  });

  it('안정 id가 없으면(null) 플러그인 항목을 노출하지 않는다', () => {
    renderProbe({
      positions: { '4key': [keyPos(ID_1)] },
      keyMappings: { '4key': ['A'] },
    });

    const items = latest().getKeyMenuItems(0, null);
    expect(seenContexts).toHaveLength(0);
    expect(items.some((item) => item.isPlugin)).toBe(false);
  });

  it('id 미전달 호출은 기존 index 해석을 유지한다', () => {
    renderProbe({
      positions: { '4key': [keyPos(ID_1), keyPos(ID_2)] },
      keyMappings: { '4key': ['A', 'B'] },
    });

    const items = latest().getKeyMenuItems(1);
    const pluginItem = items.find((item) => item.id === 'pluginA::inspect')!;
    expect(seenContexts.at(-1)).toMatchObject({
      id: ID_2,
      index: 1,
      keyCode: 'B',
    });
    expect(pluginItem.disabled).toBe(true);
  });
});
