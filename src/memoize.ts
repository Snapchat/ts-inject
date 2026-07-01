type AnyFunction<A extends any[] = any[], B = any> = (...args: A) => B;

export type Memoized<Fn extends AnyFunction> = {
  (...args: Parameters<Fn>): ReturnType<Fn>;
  delegate: Fn;
};

export function isMemoized(fn: unknown): fn is Memoized<AnyFunction> {
  return typeof fn === "function" && typeof (fn as any).delegate === "function";
}

export function memoize<Fn extends AnyFunction>(delegate: Fn): Memoized<Fn> {
  // Track invocation with a flag rather than checking `memo` against `undefined`, so that
  // factories which legitimately return `undefined` are still only invoked once. The flag is
  // set only after `delegate` returns, preserving the existing behavior of retrying on throw.
  let invoked = false;
  let memo: any;
  const memoized = function (this: any, ...args: any[]) {
    if (invoked) return memo;
    memo = delegate.apply(this, args);
    invoked = true;
    return memo;
  };
  memoized.delegate = delegate;
  return memoized as Memoized<Fn>;
}
