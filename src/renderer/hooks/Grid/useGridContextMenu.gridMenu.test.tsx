/**
 * 그리드 배경 컨텍스트 메뉴 항목 테스트
 * 플러그인 항목을 비운 상태에서 기본 항목 구성과 OBS 모드 노출 규칙을 검증
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridContextMenu } from '@hooks/Grid/useGridContextMenu';
import en from '@src/renderer/locales/en.json';
import ko from '@src/renderer/locales/ko.json';
import ru from '@src/renderer/locales/ru.json';
import zhHant from '@src/renderer/locales/zh-Hant.json';
import zhCn from '@src/renderer/locales/zh-cn.json';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@stores/plugin/usePluginMenuStore', () => ({
  usePluginMenuStore: <T,>(
    selector: (state: { keyMenuItems: never[]; gridMenuItems: never[] }) => T,
  ) => selector({ keyMenuItems: [], gridMenuItems: [] }),
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: <T,>(
    selector: (state: { definitions: never[] }) => T,
  ) => selector({ definitions: [] }),
}));

const settings = vi.hoisted(() => ({
  useCustomCSS: true,
  obsModeEnabled: false,
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: <T,>(selector: (state: typeof settings) => T) =>
    selector(settings),
}));

const locales = {
  en,
  ko,
  ru,
  'zh-Hant': zhHant,
  'zh-cn': zhCn,
} as unknown as Record<
  string,
  { contextMenu: Record<string, string | undefined> }
>;

// 렌더 중 외부 상태를 건드리지 않도록 effect에서 결과를 넘긴다
const captured: {
  items: { id: string; label: string; disabled?: boolean }[];
} = { items: [] };

describe('그리드 컨텍스트 메뉴', () => {
  let container: HTMLDivElement;
  let root: Root;

  const Probe = () => {
    const { getGridMenuItems } = useGridContextMenu({
      selectedKeyType: '4key',
      keyMappings: { '4key': [] },
      positions: { '4key': [] },
      locale: 'ko',
      t: (key: string) => key,
      noteEffect: true,
    });
    const items = getGridMenuItems({ dx: 0, dy: 0 });
    useEffect(() => {
      captured.items = items;
    }, [items]);
    return null;
  };

  const mount = () => {
    root = createRoot(container);
    act(() => {
      root.render(<Probe />);
    });
  };

  beforeEach(() => {
    captured.items = [];
    settings.obsModeEnabled = false;
    container = document.createElement('div');
    document.body.append(container);
    mount();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('오버레이 위치 초기화 항목을 노출한다', () => {
    const item = captured.items.find(
      (entry) => entry.id === 'resetOverlayPosition',
    );
    expect(item).toBeDefined();
    expect(item?.label).toBe('contextMenu.resetOverlayPosition');
    expect(item?.disabled).toBeUndefined();
  });

  it('기존 항목 순서를 유지하고 마지막에 붙는다', () => {
    expect(captured.items.map((entry) => entry.id)).toEqual([
      'add',
      'addStat',
      'addGraph',
      'addKnob',
      'tabCss',
      'tabNote',
      'resetOverlayPosition',
    ]);
  });

  it('OBS 모드에서는 항목을 감춘다', () => {
    act(() => root.unmount());
    settings.obsModeEnabled = true;
    mount();

    expect(captured.items.map((entry) => entry.id)).toEqual([
      'add',
      'addStat',
      'addGraph',
      'addKnob',
      'tabCss',
      'tabNote',
    ]);
  });

  it('5개 로케일 모두 번역을 갖는다', () => {
    Object.entries(locales).forEach(([name, messages]) => {
      const value = messages.contextMenu.resetOverlayPosition;
      expect(value, name).toBeTruthy();
    });
  });
});
