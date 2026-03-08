import { Container } from "../Container";
import { Injectable } from "../Injectable";
import { PartialContainer } from "../PartialContainer";
import type { InjectableFunction } from "../types";

function mockInjectable<Fn extends InjectableFunction<any, readonly string[], string, any>>(fn: Fn): Fn {
  const mockFn: any = jest.fn().mockImplementation(fn);
  mockFn.token = fn.token;
  mockFn.dependencies = fn.dependencies;
  return mockFn;
}

describe("PartialContainer", () => {
  let container: PartialContainer;

  beforeEach(() => {
    container = new PartialContainer({});
  });

  describe("when providing a Service", () => {
    const dependenciesContainer = new Container({});
    let injectable: InjectableFunction<any, [], "TestService", string>;
    let containerWithService: PartialContainer<{ TestService: string }>;

    beforeEach(() => {
      injectable = mockInjectable(Injectable("TestService", () => "testService"));
      containerWithService = container.provides(injectable);
    });

    test("a new PartialContainer is returned, which provides the Service factory function.", () => {
      const testServiceFactory = containerWithService.getFactories(dependenciesContainer).TestService;
      expect(testServiceFactory()).toEqual(injectable());
    });
    test("the Service factory function is memoized.", () => {
      const testServiceFactory = containerWithService.getFactories(dependenciesContainer).TestService;
      testServiceFactory();
      testServiceFactory();
      expect(injectable).toBeCalledTimes(1);
    });
  });

  describe("when providing a Service with dependencies", () => {
    let injectable: InjectableFunction<{ Dependency: string }, readonly ["Dependency"], "TestService", string>;
    let containerWithService: PartialContainer<{ TestService: string }, { Dependency: string }>;

    beforeEach(() => {
      injectable = mockInjectable(
        Injectable("TestService", ["Dependency"] as const, (dependency: string) => {
          return `${dependency} + testService`;
        })
      );
      containerWithService = container.provides(injectable);
    });

    describe("and those dependencies are fulfilled by a Container", () => {
      const dependencyInjectable = Injectable("Dependency", () => "dependency");
      let combinedContainer: Container<{ Dependency: string; TestService: string }>;

      beforeEach(() => {
        combinedContainer = Container.provides(dependencyInjectable).provides(containerWithService);
      });

      test("the Service can be resolved.", () => {
        expect(combinedContainer.get("TestService")).toEqual(injectable(dependencyInjectable()));
      });
    });

    describe("and those dependencies are fulfilled by the PartialContainer", () => {
      const dependencyInjectable = Injectable("Dependency", () => "dependency");
      let combinedContainer: Container<{ Dependency: string; TestService: string }>;

      beforeEach(() => {
        const combinedPartialContainer = containerWithService.provides(dependencyInjectable);
        combinedContainer = Container.provides(combinedPartialContainer);
      });

      test("the Service can be resolved.", () => {
        expect(combinedContainer.get("TestService")).toEqual(injectable(dependencyInjectable()));
      });
    });

    describe("and those dependencies are fulfilled by a Container and the PartialContainer", () => {
      const dependencyInjectableFromPartial = Injectable("Dependency", () => "from PartialContainer");
      const dependencyInjectableFromContainer = Injectable("Dependency", () => "from Container");
      let combinedContainer: Container<{ Dependency: string; TestService: string }>;

      beforeEach(() => {
        const combinedPartialContainer = containerWithService.provides(dependencyInjectableFromPartial);
        combinedContainer = Container.provides(dependencyInjectableFromContainer).provides(combinedPartialContainer);
      });

      test("the Service is resolved with the dependency from the PartialContainer", () => {
        expect(combinedContainer.get("TestService")).toEqual(injectable(dependencyInjectableFromPartial()));
      });
    });
  });

  describe("fromObject", () => {
    test("creates a PartialContainer from a plain object", () => {
      const partial = PartialContainer.fromObject({ foo: 1, bar: "baz" });
      const combined = Container.provides(partial);
      expect(combined.get("foo")).toBe(1);
      expect(combined.get("bar")).toBe("baz");
    });
  });

  describe("when providing another PartialContainer", () => {
    test("merges services from both PartialContainers", () => {
      const partial1 = new PartialContainer({}).provides("A", () => "a");
      const partial2 = new PartialContainer({}).provides("B", () => "b");
      const merged = partial1.provides(partial2);
      const combined = Container.provides(merged);
      expect(combined.get("A")).toBe("a");
      expect(combined.get("B")).toBe("b");
    });

    test("services from the provided PartialContainer take precedence", () => {
      const partial1 = new PartialContainer({}).provides("A", () => "old");
      const partial2 = new PartialContainer({}).provides("A", () => "new");
      const merged = partial1.provides(partial2);
      expect(Container.provides(merged).get("A")).toBe("new");
    });

    test("combines dependencies, excluding services provided by either partial", () => {
      const partial1 = new PartialContainer({}).provides("A", ["X"] as const, (x: string) => x);
      const partial2 = new PartialContainer({}).provides("X", () => "x-value");
      // partial1 needs X, partial2 provides X — merged should have no unresolved deps
      const merged = partial1.provides(partial2);
      const combined = Container.provides(merged);
      expect(combined.get("A")).toBe("x-value");
    });

    test("tracks unresolved dependencies from both partials", () => {
      const partial1 = new PartialContainer({}).provides("A", ["X"] as const, (x: string) => x);
      const partial2 = new PartialContainer({}).provides("B", ["Y"] as const, (y: number) => y);
      const merged = partial1.provides(partial2);
      // @ts-expect-error both X and Y are unresolved
      Container.provides(merged);
      // Providing both deps should work
      Container.providesValue("X", "x").providesValue("Y", 1).provides(merged);
    });
  });

  describe("when providing a Container", () => {
    test("merges Container services into the PartialContainer", () => {
      const partial = new PartialContainer({}).provides("A", () => "a");
      const existingContainer = Container.providesValue("B", "b");
      const merged = partial.provides(existingContainer);
      const combined = Container.provides(merged);
      expect(combined.get("A")).toBe("a");
      expect(combined.get("B")).toBe("b");
    });

    test("Container services satisfy PartialContainer dependencies", () => {
      const partial = new PartialContainer({}).provides("A", ["B"] as const, (b: string) => `got ${b}`);
      const existingContainer = Container.providesValue("B", "b-value");
      const merged = partial.provides(existingContainer);
      // B is now provided by the merged container, so no external deps needed
      const combined = Container.provides(merged);
      expect(combined.get("A")).toBe("got b-value");
    });

    test("Container services take precedence over existing PartialContainer services", () => {
      const partial = new PartialContainer({}).provides("A", () => "old");
      const existingContainer = Container.providesValue("A", "new");
      const merged = partial.provides(existingContainer);
      expect(Container.provides(merged).get("A")).toBe("new");
    });
  });

  describe("when providing a Service using inline token and factory", () => {
    test("provides a zero-dep service via provides(token, factory)", () => {
      const partial = new PartialContainer({}).provides("TestService", () => "testService");
      const combined = Container.provides(partial);
      expect(combined.get("TestService")).toBe("testService");
    });

    test("provides a service with dependencies via provides(token, deps, factory)", () => {
      const partial = new PartialContainer({}).provides(
        "TestService",
        ["dep"] as const,
        (dep: string) => `value is ${dep}`
      );
      const combined = Container.providesValue("dep", "hello").provides(partial);
      expect(combined.get("TestService")).toBe("value is hello");
    });

    test("tracks unresolved dependencies from inline factory", () => {
      const partial = new PartialContainer({}).provides("TestService", ["dep"] as const, (dep: string) => dep);
      // @ts-expect-error should fail because 'dep' is not provided
      Container.provides(partial);

      // succeeds when dependency is provided
      Container.providesValue("dep", "hello").provides(partial);
    });
  });

  test("type error targets factory when arity doesn't match deps", () => {
    expect(() =>
      new PartialContainer({})
        .provides(
          "Foo",
          ["bar"] as const,
          // @ts-expect-error factory has 2 params but only 1 dependency
          (bar: string, extra: number) => bar
        )
        .provides("Baz", () => "baz") // should compile — no `never` propagation
    ).toThrowError(TypeError);
  });

  describe("when providing a Service using the same Token as an existing Service", () => {
    describe("provided by the PartialContainer", () => {
      describe("and the new Service does not depend on the old Service", () => {
        const injectable = Injectable("TestService", () => "new service");
        let containerWithService: PartialContainer<{ TestService: string }>;

        beforeEach(() => {
          containerWithService = container
            .provides(Injectable("TestService", () => "old service"))
            .provides(injectable);
        });

        test("the new Service overwrites the old Service", () => {
          expect(new Container({}).provides(containerWithService).get("TestService")).toEqual(injectable());
        });
      });

      describe("and the new Service depends on the old Service", () => {
        let oldInjectableFromPartial: InjectableFunction<{}, [], "TestService", string>;
        const injectable = Injectable("TestService", ["TestService"] as const, (ts: string) => `replaced ${ts}`);
        let containerWithService: PartialContainer<{ TestService: string }, {}>;

        beforeEach(() => {
          oldInjectableFromPartial = mockInjectable(
            Injectable("TestService", () => {
              return "old service from partial";
            })
          );
          containerWithService = container.provides(oldInjectableFromPartial).provides(injectable);
        });

        test(
          "the old Service is never invoked, and the PartialContainer must be provided to a Container " +
            "that fulfills the dependency",
          () => {
            expect(() => {
              new Container({}).provides(containerWithService).get("TestService");
            }).toThrow(/Could not find Service for Token "TestService"/);

            new Container({})
              .provides(Injectable("TestService", () => "old service from container"))
              .provides(containerWithService)
              .get("TestService");

            expect(oldInjectableFromPartial).not.toBeCalled();
          }
        );

        test("the new Service is injected with the old Service", () => {
          const oldInjectableFromContainer = Injectable("TestService", () => "old service from container");
          expect(
            new Container({}).provides(oldInjectableFromContainer).provides(containerWithService).get("TestService")
          ).toEqual(injectable(oldInjectableFromContainer()));
        });
      });
    });

    describe("provide service using provideValue", () => {
      const dependenciesContainer = Container.provides(Injectable("TestService", () => "old service"));

      test("and the new Service does not override", () => {
        const partialContainer = new PartialContainer({}).providesValue("NewTestService", "new service");
        expect(dependenciesContainer.provides(partialContainer).get("NewTestService")).toEqual("new service");
      });

      test("and the new Service does override", () => {
        const partialContainer = new PartialContainer({}).providesValue("TestService", "new service");
        expect(dependenciesContainer.provides(partialContainer).get("TestService")).toEqual("new service");
      });
    });

    describe("provide service using provideClass", () => {
      const dependenciesContainer = Container.provides(Injectable("TestService", () => "old service"));

      class NewTestService {
        static dependencies = ["TestService"] as const;
        constructor(public testService: string) {}
      }

      describe("and the new Service does not override", () => {
        const partialContainer = new PartialContainer({}).providesClass("NewTestService", NewTestService);
        test("fails if parent missing dependency", () => {
          // @ts-expect-error should be a compile error because nothing provides "TestService"
          expect(() => Container.provides(partialContainer).get("NewTestService")).toThrow(
            /Could not find Service for Token "TestService"/
          );
        });
        test("succeeds if parent has dependency", () => {
          expect(dependenciesContainer.provides(partialContainer).get("NewTestService")).toBeInstanceOf(NewTestService);
        });
      });

      test("and the new Service does override", () => {
        const partialContainer = new PartialContainer({})
          .providesValue("TestService", "old service")
          .providesClass("TestService", NewTestService);
        let testService = dependenciesContainer.provides(partialContainer).get("TestService");
        expect(testService).toBeInstanceOf(NewTestService);
        expect(testService.testService).toEqual("old service");
      });
    });

    describe("provided by an existing Container", () => {
      const dependenciesContainer = Container.provides(Injectable("TestService", () => "old service"));
      let combinedContainer: Container<{ TestService: string }>;

      describe("and the new Service does not depend on the old Service", () => {
        const injectable = Injectable("TestService", () => "new service");

        beforeEach(() => {
          const partialContainer = new PartialContainer({}).provides(injectable);
          combinedContainer = dependenciesContainer.provides(partialContainer);
        });

        test("the new Service overwrites the old Service", () => {
          expect(combinedContainer.get("TestService")).toEqual(injectable());
        });
      });

      describe("and the new Service depends on the old Service", () => {
        const injectable = Injectable("TestService", ["TestService"] as const, (ts: string) => `replaced ${ts}`);

        beforeEach(() => {
          const partialContainer = new PartialContainer({}).provides(injectable);
          combinedContainer = dependenciesContainer.provides(partialContainer);
        });

        test("the new Service is injected with the old Service", () => {
          expect(combinedContainer.get("TestService")).toEqual(injectable("old service"));
        });
      });
    });
  });
});
