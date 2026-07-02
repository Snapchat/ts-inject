import { isMemoized, memoize } from "../memoize";

describe("memoize", () => {
  test("invokes the delegate only once and returns the cached result", () => {
    const delegate = jest.fn().mockReturnValue("value");
    const memoized = memoize(delegate);

    expect(memoized()).toBe("value");
    expect(memoized()).toBe("value");
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  test("invokes the delegate only once even when it returns undefined", () => {
    const delegate = jest.fn().mockReturnValue(undefined);
    const memoized = memoize(delegate);

    expect(memoized()).toBeUndefined();
    expect(memoized()).toBeUndefined();
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  test("does not cache when the delegate throws, allowing a retry", () => {
    const delegate = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("first call fails");
      })
      .mockReturnValue("recovered");
    const memoized = memoize(delegate);

    expect(() => memoized()).toThrowError("first call fails");
    expect(memoized()).toBe("recovered");
    expect(delegate).toHaveBeenCalledTimes(2);
  });

  test("exposes the original function via delegate and is detected by isMemoized", () => {
    const delegate = () => 42;
    const memoized = memoize(delegate);

    expect(memoized.delegate).toBe(delegate);
    expect(isMemoized(memoized)).toBe(true);
    expect(isMemoized(delegate)).toBe(false);
  });
});
