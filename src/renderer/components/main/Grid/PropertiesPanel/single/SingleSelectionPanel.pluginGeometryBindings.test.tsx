/**
 * 플러그인 요소 위치·크기 입력의 게스처 배선 계약
 * - 네 입력 모두 onPreview/onCancel을 받아 접두 스크럽과 preview 경로가 켜진다
 * - 각 입력이 자기 축(field)으로 preview/commit을 전달한다
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginSelectionPanel } from './SingleSelectionPanel';

const captured = vi.hoisted(() => ({
  numbers: new Map<
    string,
    {
      onChange: (value: number) => void;
      onPreview?: (value: number) => void;
      onCancel?: () => void;
    }
  >(),
}));

vi.mock('../PropertyInputs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../PropertyInputs')>();
  return {
    ...actual,
    PropertyRow: ({ children }: { children: React.ReactNode }) => children,
    PropertySection: ({ children }: { children: React.ReactNode }) => children,
    NumberInput: (props: {
      prefix?: string;
      onChange: (value: number) => void;
      onPreview?: (value: number) => void;
      onCancel?: () => void;
    }) => {
      captured.numbers.set(props.prefix ?? '', props);
      return null;
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

describe('PluginSelectionPanel 위치·크기 게스처 배선', () => {
  const preview = vi.fn();
  const commit = vi.fn();
  const cancel = vi.fn();

  const renderPanel = (isPluginResizable: boolean) => {
    act(() => {
      root.render(
        <PluginSelectionPanel
          setPanelElement={vi.fn()}
          pluginTitle="테스트 플러그인"
          setPluginScrollRef={vi.fn()}
          isPluginResizable={isPluginResizable}
          selectedPluginElement={null}
          pluginDisplaySize={{ width: 200, height: 150 }}
          handlePluginGeometryPreview={preview}
          handlePluginGeometryCommit={commit}
          handlePluginGeometryCancel={cancel}
          hasSinglePluginSelection
          showModalHint={false}
          showSettings={false}
          renderPluginSettingsForm={() => null}
          reportNormalizationError={vi.fn()}
          selectedPluginDefinition={null}
          resolvedPluginSettings={{}}
          handlePluginSettingChange={vi.fn()}
          t={() => undefined}
        />,
      );
    });
  };

  beforeEach(() => {
    captured.numbers.clear();
    preview.mockClear();
    commit.mockClear();
    cancel.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    renderPanel(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each([
    ['X', 'x'],
    ['Y', 'y'],
    ['W', 'width'],
    ['H', 'height'],
  ] as const)(
    '%s 입력은 %s 축으로 preview·commit·cancel을 전달한다',
    (prefix, field) => {
      const input = captured.numbers.get(prefix);
      expect(input).toBeDefined();
      expect(input?.onPreview).toBeTypeOf('function');
      expect(input?.onCancel).toBeTypeOf('function');

      input?.onPreview?.(12);
      input?.onChange(34);
      input?.onCancel?.();

      expect(preview).toHaveBeenCalledWith(field, 12);
      expect(commit).toHaveBeenCalledWith(field, 34);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('선택 지문이 같아도 기하 섹션이 언마운트되면 세션을 취소한다', () => {
    expect(cancel).not.toHaveBeenCalled();

    renderPanel(false);

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
