import type { PluginMenuItem } from '@src/types/plugin/api';

export interface EvaluatedPluginMenuItem {
  id: string;
  label: string;
  disabled: boolean;
}

export type PluginMenuPredicateErrorHandler = (
  index: number,
  kind: 'visible' | 'disabled',
  error: unknown,
) => void;

// 요소 컨텍스트 메뉴의 visible/disabled/position 계약 이행 —
// grid/key 메뉴(useGridContextMenu)와 동일 의미, 단 렌더 경로에서 평가되므로
// predicate 예외는 fail-closed로 격리 (visible 예외→숨김, disabled 예외→클릭 불가)
export const evaluatePluginMenuItems = <TContext>(
  items: PluginMenuItem<TContext>[] | undefined,
  context: TContext,
  translateLabel: (label: string) => string,
  onPredicateError?: PluginMenuPredicateErrorHandler,
): { top: EvaluatedPluginMenuItem[]; bottom: EvaluatedPluginMenuItem[] } => {
  const top: EvaluatedPluginMenuItem[] = [];
  const bottom: EvaluatedPluginMenuItem[] = [];

  (items ?? []).forEach((item, index) => {
    let visible = true;
    if (typeof item.visible === 'function') {
      try {
        visible = Boolean(item.visible(context));
      } catch (error) {
        onPredicateError?.(index, 'visible', error);
        visible = false;
      }
    } else if (item.visible !== undefined) {
      visible = item.visible;
    }
    if (!visible) return;

    let disabled = false;
    if (typeof item.disabled === 'function') {
      try {
        disabled = Boolean(item.disabled(context));
      } catch (error) {
        onPredicateError?.(index, 'disabled', error);
        disabled = true;
      }
    } else if (item.disabled !== undefined) {
      disabled = item.disabled;
    }

    // 원본 index 유지 — 클릭 핸들러가 customItems[index]로 역참조
    const evaluated: EvaluatedPluginMenuItem = {
      id: `custom-${index}`,
      label: translateLabel(item.label),
      disabled,
    };
    (item.position === 'top' ? top : bottom).push(evaluated);
  });

  return { top, bottom };
};
