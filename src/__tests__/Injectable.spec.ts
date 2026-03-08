import { Injectable } from "../Injectable";

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
