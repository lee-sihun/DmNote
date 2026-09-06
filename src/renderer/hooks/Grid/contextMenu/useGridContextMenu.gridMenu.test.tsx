/**
 * 그리드 배경 컨텍스트 메뉴 항목 테스트
 * 플러그인 항목을 비운 상태에서 기본 항목 구성과 OBS 모드 노출 규칙을 검증
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridContextMenu } from '@hooks/Grid/contextMenu/useGridContextMenu';
import { usePanelHostStore } from '@stores/grid/usePanelHostStore';
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

// 훅 인자로 들어가는 값이라 스토어 목과 따로 둔다
const probe = { noteEffect: true };

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
interface CapturedItem {
  id: string;
  label?: string;
  disabled?: boolean;
  children?: CapturedItem[];
}

const captured: { items: CapturedItem[] } = { items: [] };

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
      noteEffect: probe.noteEffect,
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
    settings.useCustomCSS = true;
    probe.noteEffect = true;
    container = document.createElement('div');
    document.body.append(container);
    mount();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('오버레이 위치 초기화를 위치 묶음 안에 넣는다', () => {
    const group = captured.items.find((entry) => entry.id === 'resetGroup');
    const item = group?.children?.find(
      (child) => child.id === 'resetOverlayPosition',
    );
    expect(item).toBeDefined();
    expect(item?.label).toBe('contextMenu.overlayTarget');
    expect(item?.disabled).toBeUndefined();
  });

  it('추가 동작만 선으로 가르고 설정과 초기화는 한 묶음으로 둔다', () => {
    expect(captured.items.map((entry) => entry.id)).toEqual([
      'add',
      'addStat',
      'addGraph',
      'addKnob',
      'separator-1',
      'tabGroup',
      'resetGroup',
    ]);
  });

  it('플러그인이 없으면 선이 겹치거나 끝에 남지 않는다', () => {
    const ids = captured.items.map((entry) => entry.id);
    expect(ids[0].startsWith('separator')).toBe(false);
    expect(ids[ids.length - 1].startsWith('separator')).toBe(false);
    ids.forEach((id, index) => {
      if (!id.startsWith('separator')) return;
      expect(ids[index + 1]?.startsWith('separator')).toBe(false);
    });
  });

  it('OBS 모드에서는 오버레이 항목만 감추고 패널 항목은 남긴다', () => {
    act(() => root.unmount());
    settings.obsModeEnabled = true;
    mount();

    expect(captured.items.map((entry) => entry.id)).toEqual([
      'add',
      'addStat',
      'addGraph',
      'addKnob',
      'separator-1',
      'tabGroup',
      'resetGroup',
    ]);
  });

  it('도킹 중에는 분리 패널 초기화를 잠그고 분리하면 푼다', () => {
    const findPanelItem = () =>
      captured.items
        .find((entry) => entry.id === 'resetGroup')
        ?.children?.find((child) => child.id === 'resetPanelPosition');

    expect(findPanelItem()?.disabled).toBe(true);

    act(() => root.unmount());
    usePanelHostStore.setState({ placement: 'detached' });
    mount();

    expect(findPanelItem()?.disabled).toBe(false);
    usePanelHostStore.setState({ placement: 'docked' });
  });

  it('OBS 모드에서도 분리 패널 초기화는 묶음 안에 남는다', () => {
    act(() => root.unmount());
    settings.obsModeEnabled = true;
    mount();

    const group = captured.items.find((entry) => entry.id === 'resetGroup');
    expect(group?.children?.map((child) => child.id)).toEqual([
      'resetPanelPosition',
    ]);
  });

  it('자식이 전부 잠기면 묶음 행도 잠근다', () => {
    const tabGroup = () =>
      captured.items.find((entry) => entry.id === 'tabGroup');

    expect(tabGroup()?.disabled).toBe(false);

    // 신규 설치 기본값 - CSS도 트랙도 꺼져 있다
    act(() => root.unmount());
    settings.useCustomCSS = false;
    probe.noteEffect = false;
    mount();

    // 열 수 있어 보이는데 안이 전부 잠긴 막다른 서브메뉴가 되면 안 된다
    expect(tabGroup()?.disabled).toBe(true);
    expect(tabGroup()?.children?.every((child) => child.disabled)).toBe(true);
  });

  it('자식 하나라도 살아 있으면 묶음 행은 열린다', () => {
    act(() => root.unmount());
    settings.useCustomCSS = false;
    mount();

    expect(
      captured.items.find((entry) => entry.id === 'tabGroup')?.disabled,
    ).toBe(false);
  });

  // 메뉴가 실제로 부르는 키만 지킨다. 쓰이지 않는 키를 지키면 번역이 비어도 통과한다
  it('메뉴가 쓰는 키는 5개 로케일 모두 번역을 갖는다', () => {
    const used = [
      'currentTabGroup',
      'resetPositionGroup',
      'cssSetting',
      'trackSetting',
      'overlayTarget',
      'panelTarget',
      'plugins',
    ] as const;

    Object.entries(locales).forEach(([name, messages]) => {
      used.forEach((key) => {
        expect(messages.contextMenu[key], `${name}.${key}`).toBeTruthy();
      });
    });
  });
});
