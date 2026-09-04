import { useLayoutEffect, useState } from 'react';
import {
  commitStableHandlerSlots,
  getStableHandlers,
  type HandlerImplementation,
  type PendingHandlerSlotMap,
  type StableHandlerSlotMap,
} from '@utils/core/stableHandlerSlots';

export const useStableHandlerSlots = () => {
  const [slots] = useState<StableHandlerSlotMap>(() => new Map());
  const pending: PendingHandlerSlotMap = new Map();

  useLayoutEffect(() => {
    commitStableHandlerSlots(slots, pending);
  });

  return <Handlers extends HandlerImplementation>(
    id: string,
    implementation: Handlers,
  ): Handlers => getStableHandlers(slots, pending, id, implementation);
};
