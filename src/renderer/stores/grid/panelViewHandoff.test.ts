import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('panelViewHandoff contract', () => {
  let handoff: typeof import('./panelViewHandoff');
  let panelStore: typeof import('./usePropertiesPanelStore');

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    window.__dmn_window_type = 'main';
    handoff = await import('./panelViewHandoff');
    panelStore = await import('./usePropertiesPanelStore');
    panelStore.usePropertiesPanelStore.setState({
      canvasPanelMode: 'property',
      canvasPanelActiveTab: 'layer',
      propertyPanelActiveTab: 'style',
      isCanvasPanelOpen: true,
    });
  });

  it('현재 mode와 두 탭을 완전한 snapshot으로 만든다', () => {
    panelStore.usePropertiesPanelStore.setState({
      canvasPanelMode: 'layer',
      canvasPanelActiveTab: 'grid',
      propertyPanelActiveTab: 'note',
    });

    expect(handoff.capturePanelViewState()).toEqual({
      mode: 'layer',
      activeTab: 'grid',
      propertyActiveTab: 'note',
    });
  });

  it('네이티브 snapshot의 유효한 필드를 적용한다', () => {
    handoff.applyPanelViewState({
      mode: 'layer',
      activeTab: 'grid',
      propertyActiveTab: 'counter',
    });

    expect(panelStore.usePropertiesPanelStore.getState()).toEqual(
      expect.objectContaining({
        canvasPanelMode: 'layer',
        canvasPanelActiveTab: 'grid',
        propertyPanelActiveTab: 'counter',
      }),
    );
  });

  it('부분 mirror의 잘못된 탭은 기존 상태를 덮지 않는다', () => {
    handoff.applyPanelViewState({
      mode: 'layer',
      activeTab: 'style' as 'grid',
      propertyActiveTab: 'invalid' as 'note',
    });

    expect(panelStore.usePropertiesPanelStore.getState()).toEqual(
      expect.objectContaining({
        canvasPanelMode: 'layer',
        canvasPanelActiveTab: 'layer',
        propertyPanelActiveTab: 'style',
      }),
    );
  });
});
