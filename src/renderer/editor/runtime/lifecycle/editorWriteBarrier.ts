const pendingWrites = new Set<Promise<boolean>>();
const activeBarriers = new Set<Set<Promise<boolean>>>();

export const trackEditorWrite = <T>(write: Promise<T>): Promise<T> => {
  const tracked = write.then(
    () => true,
    () => false,
  );
  pendingWrites.add(tracked);
  void tracked.then(() => pendingWrites.delete(tracked));
  for (const barrier of activeBarriers) barrier.add(tracked);
  return write;
};

export const drainEditorWrites = async (): Promise<boolean> => {
  let succeeded = true;
  while (pendingWrites.size > 0) {
    const results = await Promise.all([...pendingWrites]);
    if (results.some((result) => !result)) succeeded = false;
  }
  return succeeded;
};

export const beginEditorWriteBarrier = () => {
  const writes = new Set<Promise<boolean>>();
  activeBarriers.add(writes);

  return async (): Promise<boolean> => {
    let succeeded = true;
    while (writes.size > 0) {
      const batch = [...writes];
      writes.clear();
      const results = await Promise.all(batch);
      if (results.some((result) => !result)) succeeded = false;
    }
    activeBarriers.delete(writes);
    return succeeded;
  };
};
