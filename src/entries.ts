// `Object.entries` does not use `keyof` types, so it loses type specificity. We'll fix this with a wrapper.
export const entries = <T extends { [s: string]: U } | ArrayLike<U>, U>(o: T): Array<[keyof T, T[keyof T]]> =>
  Object.entries(o) as unknown as Array<[keyof T, T[keyof T]]>;

/**
 * Walk an object's prototype chain in derivation order (most-derived first), invoking `cb`
 * once for each enumerable string key with its own-property value at the level where it was
 * declared. Keys defined at a more-derived level shadow inherited ones, just like normal
 * property lookup.
 *
 * Why this exists: `for...in` is O(N²) on deep `Object.create` chains in V8 (the engine
 * deduplicates keys as it descends), and so is `obj[k]` lookup. Chained `provides()` calls
 * now build prototype-linked factory maps; this helper keeps full traversal linear (≈90×
 * faster than `for...in` at chain depth 8000).
 */
export function chainedForEach<V>(o: object, cb: (key: string, value: V) => void): void {
  const seen = new Set<string>();
  let cur: object | null = o;
  while (cur && cur !== Object.prototype) {
    const own = Object.keys(cur);
    for (let i = 0; i < own.length; i++) {
      const k = own[i];
      if (!seen.has(k)) {
        seen.add(k);
        cb(k, (cur as any)[k]);
      }
    }
    cur = Object.getPrototypeOf(cur);
  }
}

/**
 * Collect own + inherited enumerable string keys from a (possibly prototype-chained) object.
 * Use {@link chainedForEach} if you also need values — this helper exists for cases that
 * only need the key set.
 */
export function chainedKeys(o: object): string[] {
  const keys: string[] = [];
  chainedForEach(o, (k) => keys.push(k));
  return keys;
}
