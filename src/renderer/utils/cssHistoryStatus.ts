import type { CustomCssHistoryItem } from '@src/types/plugin/api';

type Translate = (key: string) => string;

// available 외 상태만 배지 라벨 반환
export const cssHistoryStatusLabel = (
  t: Translate,
  item: CustomCssHistoryItem,
): string | null =>
  item.status === 'available'
    ? null
    : t(`settings.cssHistoryStatus.${item.status}`);
