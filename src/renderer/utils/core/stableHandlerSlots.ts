export type HandlerImplementation = Record<
  string,
  (...args: never[]) => unknown
>;

export interface StableHandlerSlot {
  impl: HandlerImplementation;
  props: HandlerImplementation;
}

export type StableHandlerSlotMap = Map<string, StableHandlerSlot>;
interface PendingHandlerSlot {
  slot: StableHandlerSlot;
  impl: HandlerImplementation;
  isNew: boolean;
}

export type PendingHandlerSlotMap = Map<string, PendingHandlerSlot>;

export const getStableHandlers = <T extends HandlerImplementation>(
  slots: StableHandlerSlotMap,
  pending: PendingHandlerSlotMap,
  id: string,
  impl: T,
): T => {
  const found = slots.get(id);
  if (found) {
    pending.set(id, { slot: found, impl, isNew: false });
    return found.props as T;
  }

  const pendingEntry = pending.get(id);
  if (pendingEntry) {
    pendingEntry.impl = impl;
    return pendingEntry.slot.props as T;
  }

  const slot: StableHandlerSlot = { impl, props: {} };
  Object.keys(impl).forEach((name) => {
    slot.props[name] = ((...args: unknown[]) =>
      (slot.impl[name] as (...values: unknown[]) => unknown)(...args)) as (
      ...args: never[]
    ) => unknown;
  });
  pending.set(id, { slot, impl, isNew: true });
  return slot.props as T;
};

export const commitStableHandlerSlots = (
  slots: StableHandlerSlotMap,
  pending: ReadonlyMap<string, PendingHandlerSlot>,
): void => {
  for (const id of slots.keys()) {
    if (!pending.has(id)) slots.delete(id);
  }
  pending.forEach(({ slot, impl, isNew }, id) => {
    if (isNew) {
      slots.set(id, slot);
    } else {
      slot.impl = impl;
    }
  });
};
