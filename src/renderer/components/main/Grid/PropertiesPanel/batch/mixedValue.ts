export interface MixedValue<Value> {
  isMixed: boolean;
  value: Value;
}

export const aggregateMixedValue = <Item, Value>(
  items: readonly Item[],
  getter: (item: Item) => Value | undefined,
  defaultValue: Value,
): MixedValue<Value> => {
  if (items.length === 0) return { isMixed: false, value: defaultValue };

  const firstValue = getter(items[0]) ?? defaultValue;
  const isMixed = items.some((item) => {
    const value = getter(item) ?? defaultValue;
    if (typeof value === 'object' && typeof firstValue === 'object') {
      return JSON.stringify(value) !== JSON.stringify(firstValue);
    }
    return value !== firstValue;
  });
  return { isMixed, value: firstValue };
};
