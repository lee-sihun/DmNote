import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

import EditSessionBoundary from './EditSessionBoundary';
import { TextInput } from '../controls/PropertyInputs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const keyElement = (index: number): SelectedElement => ({
  type: 'key',
  id: `key-${index}`,
  index,
});

const pluginElement = (id: string): SelectedElement => ({
  type: 'plugin',
  id,
});

const select = (...elements: SelectedElement[]) => {
  act(() => {
    useGridSelectionStore.setState({ selectedElements: elements });
  });
};

describe('EditSessionBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useGridSelectionStore.setState({ selectedElements: [keyElement(0)] });
    useKeyStore.setState({ selectedKeyType: '4key' });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderProbe = (onMount: () => void, onUnmount: () => void) => {
    const Probe = () => {
      useEffect(() => {
        onMount();
        return onUnmount;
      }, []);
      return null;
    };
    act(() => {
      root.render(
        <EditSessionBoundary>
          <Probe />
        </EditSessionBoundary>,
      );
    });
  };

  it('선택 대상이 갈리면 편집 트리를 새로 마운트한다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    renderProbe(mount, unmount);
    expect(mount).toHaveBeenCalledTimes(1);

    select(keyElement(1));

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
  });

  it('배열만 새로 만들고 대상이 같으면 마운트를 유지한다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    renderProbe(mount, unmount);

    select(keyElement(0));

    expect(unmount).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('선택 순서만 다르면 같은 대상으로 본다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    useGridSelectionStore.setState({
      selectedElements: [keyElement(0), keyElement(1)],
    });
    renderProbe(mount, unmount);

    select(keyElement(1), keyElement(0));

    expect(unmount).not.toHaveBeenCalled();
  });

  it('구분자가 든 플러그인 ID 조합이 같아 보여도 다른 대상으로 본다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    useGridSelectionStore.setState({
      selectedElements: [
        pluginElement('plugin::a,b'),
        pluginElement('plugin::c'),
      ],
    });
    renderProbe(mount, unmount);

    select(pluginElement('plugin::a'), pluginElement('plugin::b,c'));

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
  });

  it('모드와 ID의 구분자 경계가 달라지면 다른 대상으로 본다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    useKeyStore.setState({ selectedKeyType: 'custom:a' });
    useGridSelectionStore.setState({
      selectedElements: [pluginElement('plugin::b')],
    });
    renderProbe(mount, unmount);

    act(() => {
      useKeyStore.setState({ selectedKeyType: 'custom' });
      useGridSelectionStore.setState({
        selectedElements: [pluginElement('a:plugin::b')],
      });
    });

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
  });

  it('배치 선택이 줄어들면 새로 마운트한다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    useGridSelectionStore.setState({
      selectedElements: [keyElement(0), keyElement(1), keyElement(2)],
    });
    renderProbe(mount, unmount);

    select(keyElement(0), keyElement(1));

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
  });

  it('선택이 같아도 모드가 바뀌면 새로 마운트한다', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    renderProbe(mount, unmount);

    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
  });

  // 실앱 재현의 마지막 단계를 그대로 재현한다.
  // TextInput은 포커스 중 새 prop을 받지 않고, finalize는 타이핑 여부와 무관하게
  // onBlur를 부른다. 대상이 갈린 뒤 blur하면 옛 문자열이 새 대상에 저장된다
  it('포커스된 입력은 대상이 갈리면 확정 없이 사라진다', () => {
    const commit = vi.fn();
    const Field = () => {
      // 콜백이 매 렌더 최신 대상을 가리키는 실제 구조를 그대로 흉내낸다
      const target = useGridSelectionStore(
        (state) => state.selectedElements[0]?.id ?? '',
      );
      return (
        <TextInput
          value="LShift"
          onChange={() => {}}
          onBlur={(next) => commit(target, next)}
        />
      );
    };

    act(() => {
      root.render(
        <EditSessionBoundary>
          <Field />
        </EditSessionBoundary>,
      );
    });
    const input = container.querySelector('input')!;
    act(() => input.focus());

    select(keyElement(1));

    expect(container.querySelector('input')).not.toBe(input);
    expect(commit).not.toHaveBeenCalled();
  });

  it('같은 대상이면 blur가 평소대로 확정한다', () => {
    const commit = vi.fn();
    act(() => {
      root.render(
        <EditSessionBoundary>
          <TextInput value="LShift" onChange={() => {}} onBlur={commit} />
        </EditSessionBoundary>,
      );
    });
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => input.blur());

    expect(commit).toHaveBeenCalledWith('LShift');
  });

  // 편집 트리만 사라지고 스크롤 뷰포트는 남아야 한다.
  // 뷰포트가 함께 사라지면 대상을 바꿀 때마다 패널 스크롤이 맨 위로 튄다
  it('스크롤 뷰포트를 리마운트에 끌고 들어가지 않는다', () => {
    const Viewport = () => (
      <div data-testid="viewport">
        <EditSessionBoundary>
          <span />
        </EditSessionBoundary>
      </div>
    );
    act(() => root.render(<Viewport />));
    const viewport = container.querySelector('[data-testid="viewport"]');

    select(keyElement(1));

    expect(container.querySelector('[data-testid="viewport"]')).toBe(viewport);
  });
});
