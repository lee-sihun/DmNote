import { describe, expect, it, vi } from 'vitest';
import {
  commitStableHandlerSlots,
  getStableHandlers,
  type StableHandlerSlotMap,
} from './stableHandlerSlots';

describe('stable handler slots', () => {
  it('살아있는 handler identity를 유지하면서 commit 뒤 최신 구현을 호출한다', () => {
    const slots: StableHandlerSlotMap = new Map();
    const pending = new Map();
    const firstImpl = vi.fn(() => 'first');
    const first = getStableHandlers(slots, pending, 'element-a', {
      onClick: firstImpl,
    });
    commitStableHandlerSlots(slots, pending);

    pending.clear();
    const secondImpl = vi.fn(() => 'second');
    const second = getStableHandlers(slots, pending, 'element-a', {
      onClick: secondImpl,
    });

    expect(second).toBe(first);
    expect(second.onClick()).toBe('first');
    commitStableHandlerSlots(slots, pending);
    expect(second.onClick()).toBe('second');
  });

  it('반복 add/delete 뒤 slot 수를 현재 active ID 수로 제한한다', () => {
    const slots: StableHandlerSlotMap = new Map();
    const pending = new Map();

    for (let index = 0; index < 100; index += 1) {
      pending.clear();
      getStableHandlers(slots, pending, `element-${index}`, {
        onClick: () => index,
      });
      commitStableHandlerSlots(slots, pending);
    }

    pending.clear();
    getStableHandlers(slots, pending, 'element-98', {
      onClick: () => 98,
    });
    getStableHandlers(slots, pending, 'element-99', {
      onClick: () => 99,
    });
    commitStableHandlerSlots(slots, pending);

    expect([...slots.keys()].sort()).toEqual(['element-98', 'element-99']);
  });

  it('폐기된 render의 신규 slot과 구현을 committed map에 노출하지 않는다', () => {
    const slots: StableHandlerSlotMap = new Map();
    const committedPending = new Map();
    const first = getStableHandlers(slots, committedPending, 'element-a', {
      onClick: () => 'committed',
    });
    commitStableHandlerSlots(slots, committedPending);

    const abortedPending = new Map();
    const abortedA = getStableHandlers(slots, abortedPending, 'element-a', {
      onClick: () => 'aborted-a',
    });
    getStableHandlers(slots, abortedPending, 'element-b', {
      onClick: () => 'aborted-b',
    });

    expect([...slots.keys()]).toEqual(['element-a']);
    expect(abortedA).toBe(first);
    expect(first.onClick()).toBe('committed');
  });
});
