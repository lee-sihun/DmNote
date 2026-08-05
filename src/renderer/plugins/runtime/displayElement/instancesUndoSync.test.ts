import { describe, expect, it, vi } from 'vitest';

import {
  applyCommittedPluginInstancesProjection,
  registerPluginInstancesReapplier,
} from './instancesUndoSync';

describe('plugin instances committed projection', () => {
  it('projection 구독이 예약한 trailing save를 적용 직후 취소한다', () => {
    const order: string[] = [];
    const cancelPendingSave = vi.fn(() => order.push('cancel'));
    const unregister = registerPluginInstancesReapplier(
      'plugin-projection',
      'definition-a',
      {
        cancelPendingSave,
        reapply: vi.fn(),
      },
    );

    applyCommittedPluginInstancesProjection('plugin-projection', () => {
      order.push('apply');
    });

    expect(order).toEqual(['apply', 'cancel']);
    expect(cancelPendingSave).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('해제된 definition의 저장 취소 핸들러는 호출하지 않는다', () => {
    const cancelPendingSave = vi.fn();
    const unregister = registerPluginInstancesReapplier(
      'plugin-unloaded',
      'definition-a',
      {
        cancelPendingSave,
        reapply: vi.fn(),
      },
    );
    unregister();

    applyCommittedPluginInstancesProjection('plugin-unloaded', vi.fn());

    expect(cancelPendingSave).not.toHaveBeenCalled();
  });
});
