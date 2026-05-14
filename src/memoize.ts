type AnyFunction<A extends any[] = any[], B = any> = (...args: A) => B;

export type Memoized<Fn extends AnyFunction> = {
  (...args: Parameters<Fn>): ReturnType<Fn>;
  delegate: Fn;
};

export function isMemoized(fn: unknown): fn is Memoized<AnyFunction> {
  return typeof fn === "function" && typeof (fn as any).delegate === "function";
}

export function memoize<Fn extends AnyFunction>(delegate: Fn): Memoized<Fn> {
  let memo: any;
  const memoized = function (this: any, ...args: any[]) {
    if (typeof memo !== "undefined") return memo;
    memo = delegate.apply(this, args);
    return memo;
  };
  memoized.delegate = delegate;
  return memoized as Memoized<Fn>;
}
