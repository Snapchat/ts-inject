import { Injectable } from "../Injectable";

describe("Injectable", () => {
  describe("when given invalid arguments", () => {
    test("a TypeError is thrown", () => {
      expect(() => Injectable("TestService", [] as any)).toThrowError(TypeError);
    });
  });

  describe("when given a function with arity unequal to the number of dependencies", () => {
    test("a TypeError is thrown", () => {
      expect(() => Injectable("TestService", [] as const, (_: any) => {})).toThrowError(TypeError);
    });
  });
});
