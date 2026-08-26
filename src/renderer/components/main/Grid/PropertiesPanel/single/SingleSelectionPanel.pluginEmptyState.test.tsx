import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginSelectionPanel } from './SingleSelectionPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const translations: Record<string, string> = {
  'propertiesPanel.position': '위치',
  'propertiesPanel.size': '크기',
  'propertiesPanel.pluginNoSettings': '설정할 항목이 없습니다.',
};

let host: HTMLDivElement;
let root: Root;

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
        handlePluginPositionXChange={vi.fn()}
        handlePluginPositionYChange={vi.fn()}
        handlePluginWidthChange={vi.fn()}
        handlePluginHeightChange={vi.fn()}
        hasSinglePluginSelection
        showModalHint={false}
        showSettings
        renderPluginSettingsForm={() => <p>빈 플러그인 설정 폼</p>}
        reportNormalizationError={vi.fn()}
        selectedPluginDefinition={null}
        resolvedPluginSettings={{}}
        handlePluginSettingChange={vi.fn()}
        t={(key) => translations[key]}
      />,
    );
  });
};

describe('PluginSelectionPanel empty state', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('위치와 크기를 편집할 수 있으면 플러그인 설정 빈 문구를 숨긴다', () => {
    renderPanel(true);

    expect(host.textContent).toContain('위치');
    expect(host.textContent).toContain('크기');
    expect(host.textContent).not.toContain('빈 플러그인 설정 폼');
    expect(host.textContent).not.toContain('설정할 항목이 없습니다.');
  });

  it('위치와 크기와 플러그인 설정이 모두 없을 때만 중앙 문구를 보인다', () => {
    renderPanel(false);

    expect(host.textContent).toContain('설정할 항목이 없습니다.');
    expect(host.textContent).not.toContain('위치');
    expect(host.textContent).not.toContain('크기');
  });
});
