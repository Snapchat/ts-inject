import { Injectable } from "../Injectable";

describe("Injectable", () => {
  test("is created with not dependencies specified", () => {
    expect(() => Injectable("TestService", () => {})).not.toThrow();
  });

  test("is created with empty array specified", () => {
    expect(() => Injectable("TestService", [], () => {})).not.toThrow();
  });

  test("is created with dependency specified", () => {
    expect(() => Injectable("TestService", ["a"], (_a: number) => {})).not.toThrow();
  });

  describe("when given invalid arguments", () => {
    test("a TypeError is thrown", () => {
      expect(() => Injectable("TestService", [] as any)).toThrowError(TypeError);
    });
  });

  describe("when given a function with arity unequal to the number of dependencies", () => {
    test("a compilation error is thrown", () => {
      // @ts-expect-error must fail to compile as the factory function arity doesn't match dependencies array
      expect(() => Injectable("TestService", [] as const, (_: any) => {})).toThrowError(TypeError);
    });

    test("a TypeError is thrown", () => {
      expect(() => Injectable("TestService", [] as const, ((_: any) => {}) as any)).toThrowError(TypeError);
    });
  });
});
