import { afterEach, describe, expect, it } from 'vitest';

import {
  selectGridTransformLayerPromotion,
  useGridSelectionStore,
} from './useGridSelectionStore';

afterEach(() => {
  useGridSelectionStore.setState({
    isDraggingOrResizing: false,
    isResizing: false,
  });
});

describe('grid 편집 상호작용 상태', () => {
  it('드래그는 편집 상태와 이동 레이어 승격을 함께 켠다', () => {
    useGridSelectionStore.getState().setDraggingOrResizing(true);
    const state = useGridSelectionStore.getState();

    expect(state.isDraggingOrResizing).toBe(true);
    expect(state.isResizing).toBe(false);
    expect(selectGridTransformLayerPromotion(state)).toBe(true);
  });

  it('리사이즈는 편집 상태만 켜고 이동 레이어 승격은 끈다', () => {
    useGridSelectionStore.getState().setResizing(true);
    const state = useGridSelectionStore.getState();

    expect(state.isDraggingOrResizing).toBe(true);
    expect(state.isResizing).toBe(true);
    expect(selectGridTransformLayerPromotion(state)).toBe(false);
  });

  it('리사이즈 종료는 두 상태를 함께 초기화한다', () => {
    useGridSelectionStore.getState().setResizing(true);
    useGridSelectionStore.getState().setResizing(false);
    const state = useGridSelectionStore.getState();

    expect(state.isDraggingOrResizing).toBe(false);
    expect(state.isResizing).toBe(false);
    expect(selectGridTransformLayerPromotion(state)).toBe(false);
  });
});
