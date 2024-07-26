// `Object.entries` does not use `keyof` types, so it loses type specificity. We'll fix this with a wrapper.
export const entries = <T extends { [s: string]: U } | ArrayLike<U>, U>(o: T): Array<[keyof T, T[keyof T]]> =>
  Object.entries(o) as unknown as Array<[keyof T, T[keyof T]]>;

// `Object.fromEntries` similarly does not preserve key types.
export const fromEntries = <K extends string | number | symbol, V>(entries: ReadonlyArray<[K, V]>): Record<K, V> =>
  Object.fromEntries(entries) as Record<K, V>;
