import { ConcatInjectable, Injectable, InjectableCompat } from "../Injectable";
import { Container } from "../Container";

describe("Injectable", () => {
  describe("when given invalid arguments", () => {
    test("a TypeError is thrown", () => {
      expect(() => Injectable("TestService", [] as any)).toThrowError(/Received invalid arguments/);
    });
  });

  test("type error targets factory when arity doesn't match deps", () => {
    expect(() =>
      // @ts-expect-error factory has 2 params but only 1 dependency
      Injectable("Foo", ["bar"] as const, (bar: string, extra: number) => bar)
    ).toThrowError(/Function arity does not match/);
  });

  describe("when given a function with arity unequal to the number of dependencies", () => {
    test("a TypeError is thrown", () => {
      expect(() => Injectable("TestService", [] as const, (_: any) => {})).toThrowError(
        /Function arity does not match/
      );
    });
  });
});

describe("InjectableCompat", () => {
  test("produces a working factory equivalent to Injectable()", () => {
    const fn = InjectableCompat("TestService", ["dep"] as const, (dep: number) => dep * 2);
    expect(fn.token).toBe("TestService");
    expect(fn.dependencies).toEqual(["dep"]);
    // InjectableCompat widens its return type; call through `any` to exercise the runtime body.
    expect((fn as any)(21)).toBe(42);
  });
});

describe("ConcatInjectable", () => {
  test("appends the produced value to an existing array service", () => {
    const container = Container.providesValue("items", [1] as number[]).provides(ConcatInjectable("items", () => 2));
    expect(container.get("items")).toEqual([1, 2]);
  });

  test("throws when called with no factory function", () => {
    expect(() => ConcatInjectable("items", undefined as any)).toThrowError(/Received invalid arguments/);
  });

  test("throws when factory arity does not match dependency count", () => {
    expect(() => ConcatInjectable("items", ["dep"] as const, () => 1)).toThrowError(/Function arity does not match/);
  });
});
