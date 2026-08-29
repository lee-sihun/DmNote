import type { StatItemType } from '@src/types/key/statItems';

export const getStatTypeLabel = (statType?: StatItemType | null): string => {
  switch (statType) {
    case 'kpsAvg':
      return 'AVG';
    case 'kpsMax':
      return 'MAX';
    case 'total':
      return 'Total';
    case 'kps':
    default:
      return 'KPS';
  }
};
