/**
 * 디스플레이 요소 타겟 해결 유틸리티
 * 문자열, DisplayElementInstance, 또는 기타 형식의 타겟을 fullId로 변환합니다.
 */

import { DisplayElementInstance } from '@utils/displayElementInstance';
import { getDisplayElementInstance } from './instanceRegistry';
import type { DisplayElementInstance as DisplayElementInstanceType } from '@src/types/plugin/api';

export type DisplayElementTarget =
  | string
  | DisplayElementInstance
  | DisplayElementInstanceType
  | null
  | undefined;

/**
 * 타겟에서 fullId를 추출합니다.
 */
export const resolveFullId = (target: DisplayElementTarget): string | null => {
  if (!target) return null;
  if (typeof target === 'string') return target;
  if (target instanceof DisplayElementInstance) return target.id;
  if (
    typeof target === 'object' &&
    typeof (target as DisplayElementInstanceType).id === 'string'
  ) {
    return (target as DisplayElementInstanceType).id;
  }
  if (typeof target === 'object' && 'toString' in target) {
    return String(target);
  }
  return null;
};

/**
 * 타겟에서 DisplayElementInstance를 조회합니다.
 */
export const resolveInstance = (
  target: DisplayElementTarget,
): DisplayElementInstance | undefined => {
  if (target instanceof DisplayElementInstance) {
    return target;
  }
  const fullId = resolveFullId(target);
  if (!fullId) return undefined;
  return getDisplayElementInstance(fullId);
};

/**
 * 비어있는 noop DisplayElementInstance를 생성합니다.
 * 에러 상황에서 반환하는 용도입니다.
 */
export const createNoopDisplayElementInstance = (): DisplayElementInstance =>
  new DisplayElementInstance({
    fullId: '',
    pluginId: '',
    updateElement: () => undefined,
    removeElement: () => undefined,
    locale: 'ko',
    t: (key) => key,
  });
