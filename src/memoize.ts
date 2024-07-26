type AnyFunction<A extends any[] = any[], B = any> = (...args: A) => B;

export type Memoized<Fn extends AnyFunction> = {
  (...args: Parameters<Fn>): ReturnType<Fn>;
  delegate: Fn;
  thisArg: any;
};

export function isMemoized(fn: unknown): fn is Memoized<AnyFunction> {
  return typeof fn === "function" && typeof (fn as any).delegate === "function";
}

export function memoize<Fn extends AnyFunction>(thisArg: any, delegate: Fn): Memoized<Fn> {
  let memo: any;
  const memoized = (...args: any[]) => {
    if (typeof memo !== "undefined") return memo;
    memo = delegate.apply(memoized.thisArg, args);
    return memo;
  };
  memoized.delegate = delegate;
  memoized.thisArg = thisArg;
  return memoized;
}
