// eslint-disable-next-line max-classes-per-file
import { CONTAINER, Container } from "../Container";
import { Injectable } from "../Injectable";
import { PartialContainer } from "../PartialContainer";
import type { InjectableFunction } from "../types";

function mockInjectable<Fn extends InjectableFunction<any, readonly string[], string, any>>(fn: Fn): Fn {
  const mockFn: any = jest.fn().mockImplementation(fn);
  mockFn.token = fn.token;
  mockFn.dependencies = fn.dependencies;
  return mockFn;
}

describe("Container", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container({});
  });

  describe("when creating a new Container", () => {
    describe("by providing a Service", () => {
      let injectable: InjectableFunction<any, [], "TestService", string>;
      let containerWithService: Container<{ TestService: string }>;

      beforeEach(() => {
        injectable = mockInjectable(Injectable("TestService", () => "testService"));
        containerWithService = Container.provides(injectable);
      });

      test("the Container provides the Service", () => {
        expect(containerWithService.get(injectable.token)).toEqual(injectable());
      });
    });

    describe("from object", () => {
      test("the Container provides the Service", () => {
        let fromObject = Container.fromObject({ service: 1 });
        expect(fromObject.get("service")).toBe(1);
      });
    });

    describe("by providing a PartialContainer", () => {
      let service1: InjectableFunction<any, [], "Service1", string>;
      let service2: InjectableFunction<any, [], "Service2", number>;
      let partialContainer: PartialContainer<{ Service1: string; Service2: number }>;

      beforeEach(() => {
        service1 = mockInjectable(Injectable("Service1", () => "service1"));
        service2 = mockInjectable(Injectable("Service2", () => 42));
        partialContainer = new PartialContainer({}).provides(service1).provides(service2);
      });

      test("the Container provides all Services from the PartialContainer", () => {
        const combinedContainer = Container.provides(partialContainer);
        expect(combinedContainer.get(service1.token)).toBe(service1());
        expect(combinedContainer.get(service2.token)).toBe(service2());
      });
    });

    describe("by providing another Container", () => {
      let service1: InjectableFunction<any, [], "Service1", string>;
      let service2: InjectableFunction<any, [], "Service2", number>;
      let container: Container<{ Service1: string; Service2: number }>;

      beforeEach(() => {
        service1 = mockInjectable(Injectable("Service1", () => "service1"));
        service2 = mockInjectable(Injectable("Service2", () => 42));
        container = new Container({}).provides(service1).provides(service2);
      });

      test("the new Container provides all Services from the other Container", () => {
        const combinedContainer = Container.provides(container);
        expect(combinedContainer.get(service1.token)).toBe(service1());
        expect(combinedContainer.get(service2.token)).toBe(service2());
      });
    });
  });

  describe("when providing a Service", () => {
    let injectable: InjectableFunction<any, [], "TestService", string>;
    let containerWithService: Container<{ TestService: string }>;

    beforeEach(() => {
      injectable = mockInjectable(Injectable("TestService", () => "testService"));
      containerWithService = container.provides(injectable);
    });

    test("a new Container is returned which provides the Service", () => {
      expect(containerWithService.get(injectable.token)).toEqual(injectable());
    });

    test("the InjectableFunction is only called once to create the Service", () => {
      containerWithService.get(injectable.token);
      containerWithService.get(injectable.token);
      expect(injectable).toBeCalledTimes(1);
    });
  });

  describe("when providing a Service using inline token and factory", () => {
    test("provides a zero-dep service via provides(token, factory)", () => {
      const containerWithService = Container.provides("TestService", () => "testService");
      expect(containerWithService.get("TestService")).toBe("testService");
    });

    test("provides a zero-dep service on an existing container", () => {
      const containerWithService = container.providesValue("value", 1).provides("TestService", () => "testService");
      expect(containerWithService.get("TestService")).toBe("testService");
      expect(containerWithService.get("value")).toBe(1);
    });

    test("provides a service with dependencies via provides(token, deps, factory)", () => {
      const containerWithService = Container.providesValue("dep", 42).provides(
        "TestService",
        ["dep"] as const,
        (dep: number) => `value is ${dep}`
      );
      expect(containerWithService.get("TestService")).toBe("value is 42");
    });

    test("the factory is lazily called and memoized", () => {
      const factory = jest.fn(() => "testService");
      const containerWithService = Container.provides("TestService", factory);
      expect(factory).not.toHaveBeenCalled();
      containerWithService.get("TestService");
      containerWithService.get("TestService");
      expect(factory).toHaveBeenCalledTimes(1);
    });

    test("type error when dependency token does not exist", () => {
      // @ts-expect-error 'missing' is not a valid token
      Container.providesValue("dep", 1).provides("service", ["missing"] as const, (x: any) => x);
    });

    test("type error when factory param type does not match dependency", () => {
      Container.providesValue("dep", 42).provides(
        "service",
        ["dep"] as const,
        // @ts-expect-error dep is number, not string
        (dep: string) => dep
      );
    });
  });

  describe("when providing a Service with dependencies", () => {
    let dependency: InjectableFunction<any, [], "TestDependency", string>;
    let injectable: InjectableFunction<{ TestDependency: string }, readonly ["TestDependency"], "TestService", string>;
    let containerWithService: Container<{ TestDependency: string; TestService: string }>;

    beforeEach(() => {
      injectable = mockInjectable(
        Injectable("TestService", ["TestDependency"] as const, (dep: string) => `${dep} + service`)
      );
      dependency = mockInjectable(Injectable("TestDependency", () => "dependency"));
      containerWithService = container.provides(dependency).provides(injectable);
    });

    test("a new Container is returned which provides the Service", () => {
      expect(containerWithService.get(injectable.token)).toEqual(injectable("dependency"));
    });

    test("the InjectableFunctions for the Service and its dependencies are each called only once", () => {
      containerWithService.get(injectable.token);
      containerWithService.get(injectable.token);
      expect(dependency).toBeCalledTimes(1);
      expect(injectable).toBeCalledTimes(1);
    });
  });

  describe("when providing a Service using the same Token as an existing Service", () => {
    let injectable: InjectableFunction<any, [], "TestService", string>;
    let containerWithService: Container<{ TestService: string }>;

    beforeEach(() => {
      injectable = Injectable("TestService", () => "new service");
      containerWithService = container.provides(Injectable("TestService", () => "old service")).provides(injectable);
    });

    test("the new Service overwrites the old Service", () => {
      expect(containerWithService.get(injectable.token)).toEqual(injectable());
    });

    test("the new Service may inject the old Service", () => {
      const newInjectable = Injectable("TestService", ["TestService"] as const, (ts: string) => `replaced ${ts}`);
      containerWithService = containerWithService.provides(newInjectable);
      expect(containerWithService.get(injectable.token)).toEqual(newInjectable(injectable()));
    });
  });

  describe("when providing a Service using providesClass", () => {
    const container = Container.providesValue("value", 1);

    test("test simple case", () => {
      class Item {
        static dependencies = ["value"] as const;
        constructor(public value: number) {}
      }
      const containerWithService = container.providesClass("service", Item);
      expect(containerWithService.get("service")).toEqual(new Item(1));
    });

    test("error if class constructor arity doesn't match dependencies", () => {
      class Item {
        static dependencies = ["value", "value2"] as const;
        constructor(public value: number) {}
      }
      // @ts-expect-error should be failing to compile as the constructor doesn't match dependencies
      expect(() => container.providesClass("service", Item).get("service")).toThrow();
      // should not fail now as we provide the missing dependency
      container.providesValue("value2", 2).providesClass("service", Item).get("service");
    });

    test("error if class constructor argument type doesn't match provided by container", () => {
      class Item {
        static dependencies = ["value"] as const;
        constructor(public value: string) {}
      }
      // @ts-expect-error must fail to compile as the constructor argument type doesn't match dependencies
      container.providesClass("service", Item).get("service");
      // should not fail now as we provide the correct type
      container.providesValue("value", "1").providesClass("service", Item).get("service");
    });

    test("error if class constructor argument type doesn't match provided by container", () => {
      class Item {
        static dependencies = ["value"] as const;
        constructor(
          public value: number,
          public value2: string
        ) {}
      }
      // @ts-expect-error must fail to compile as the constructor arity type doesn't match dependencies array length
      container.providesValue("value2", "2").providesClass("service", Item).get("service");
    });
  });

  describe("when providing a PartialContainer", () => {
    let service1: InjectableFunction<any, [], "Service1", string>;
    let service2: InjectableFunction<any, [], "Service2", number>;
    let dependenciesContainer: Container<{ Service1: string }>;
    let partialContainer: PartialContainer<{ Service2: number }>;

    beforeEach(() => {
      service1 = mockInjectable(Injectable("Service1", () => "service1"));
      service2 = mockInjectable(Injectable("Service2", () => 42));

      dependenciesContainer = container.provides(service1);
      partialContainer = new PartialContainer({}).provides(service2);
    });

    test("a new Container is returned that provides services from the given PartialContainer", () => {
      const combinedContainer = dependenciesContainer.provides(partialContainer);
      expect(combinedContainer.get(service1.token)).toBe(service1());
      expect(combinedContainer.get(service2.token)).toBe(service2());
    });

    test("a new Container is returned that provides services factories of which are memoized", () => {
      dependenciesContainer.get(service1.token);
      const combinedContainer = dependenciesContainer.provides(partialContainer);
      combinedContainer.get(service1.token);
      expect(service1).toBeCalledTimes(1);
    });

    test("a new Container is returned that provides overriden service", () => {
      // the service below uses the same token, but has different signature
      const service1Override = mockInjectable(Injectable("Service1", () => 1024));
      const containerWithService1And2 = partialContainer.provides(service1Override);
      const combinedContainer = dependenciesContainer.provides(containerWithService1And2);
      const service1Value = combinedContainer.get(service1Override.token);
      expect(service1Value).toBe(service1Override());
    });
  });

  describe("when appending a Service to an existing array of Services", () => {
    test("appends value to the array", () => {
      const container = Container.providesValue("service", [] as number[])
        .appendValue("service", 1)
        .appendValue("service", 2)
        .appendValue("service", 3);
      expect(container.get("service")).toEqual([1, 2, 3]);
    });

    test("appends class to the array", () => {
      interface In {
        value2(): number;
      }
      class Item implements In {
        static dependencies = ["value"] as const;
        constructor(public value: number) {}

        value2(): number {
          return this.value * 2;
        }
      }

      const container = Container.providesValue("value", 1)
        .providesValue("service", [] as In[])
        .appendClass("service", Item)
        .appendClass("service", Item)
        .appendClass("service", Item);
      expect(container.get("service")).toEqual([new Item(1), new Item(1), new Item(1)]);
    });

    test("appends factory to the array", () => {
      const container = Container.providesValue("service", [] as number[])
        .providesValue("value", 1)
        .append(Injectable("service", ["value"] as const, (value: number) => value))
        .append(Injectable("service", () => 2))
        .append(Injectable("service", () => 3));
      expect(container.get("service")).toEqual([1, 2, 3]);
    });

    test("appends zero-dep factory via append(token, factory)", () => {
      const container = Container.providesValue("service", [] as number[])
        .append("service", () => 1)
        .append("service", () => 2);
      expect(container.get("service")).toEqual([1, 2]);
    });

    test("appends factory with dependencies via append(token, deps, factory)", () => {
      const container = Container.providesValue("value", 10)
        .providesValue("service", [] as number[])
        .append("service", ["value"] as const, (value: number) => value * 2);
      expect(container.get("service")).toEqual([20]);
    });

    test("errors when the token is not registered", () => {
      // @ts-expect-error
      new Container({}).appendValue("service", 1);
    });

    test("errors when the token is not of array type", () => {
      // @ts-expect-error
      Container.providesValue("service1", 1).appendValue("service", 2);
    });

    test("errors when new value is of different type", () => {
      // @ts-expect-error
      Container.providesValue("service", [] as number[]).appendValue("service", "1");
    });
  });

  describe("when providing another Container", () => {
    let service1: InjectableFunction<any, [], "Service1", string>;
    let service2: InjectableFunction<any, [], "Service2", number>;
    let dependenciesContainer: Container<{ Service1: string }>;
    let anotherContainer: Container<{ Service2: number }>;

    beforeEach(() => {
      service1 = mockInjectable(Injectable("Service1", () => "service1"));
      service2 = mockInjectable(Injectable("Service2", () => 42));

      dependenciesContainer = container.provides(service1);
      anotherContainer = new Container({}).provides(service2);
    });

    test("a new Container is returned that provides services from the other Container", () => {
      const combinedContainer = dependenciesContainer.provides(anotherContainer);
      expect(combinedContainer.get(service1.token)).toBe(service1());
      expect(combinedContainer.get(service2.token)).toBe(service2());
    });

    test("a new Container is returned that provides services factories of which are memoized", () => {
      dependenciesContainer.get(service1.token);
      const combinedContainer = dependenciesContainer.provides(anotherContainer);
      combinedContainer.get(service1.token);
      expect(service1).toBeCalledTimes(1);
    });

    test("a new Container is returned that provides overriden service", () => {
      // the service below uses the same token, but has different signature
      const service1Override = mockInjectable(Injectable("Service1", () => 1024));
      const containerWithService1And2 = anotherContainer.provides(service1Override);
      const combinedContainer = dependenciesContainer.provides(containerWithService1And2);
      const service1Value = combinedContainer.get(service1Override.token);
      expect(service1Value).toBe(service1Override());
    });
  });

  test("type error targets factory when arity doesn't match deps", () => {
    expect(() =>
      Container.providesValue("bar", "hello").provides(
        "Foo",
        ["bar"] as const,
        // @ts-expect-error factory has 2 params but only 1 dependency
        (bar: string, extra: number) => bar
      )
    ).toThrowError(TypeError);
  });

  describe("when retrieving a Service", () => {
    test("an Error is thrown if the Container does not contain the Service", () => {
      // We have to force an error here – without the `as any`, this fails to compile (which typically protects
      // from this happening at runtime). We still test this case, because there are some edge cases (e.g. around
      // the order in which constants are initialized vs. when a InjectableFunction is created) in which failure
      // can happen at runtime.
      const container: Container<{ TestService: string }> = new Container({} as any);
      expect(() => container.get("TestService")).toThrowError('Could not find Service for Token "TestService"');
    });
  });

  describe("when getting the Container Token", () => {
    test("the Container returns itself", () => {
      expect(container.get("$container")).toBe(container);
    });
  });

  describe("when a service depends on the $container token", () => {
    test("the service receives the container that resolved it", () => {
      const initial = Container.providesValue("value", 10);
      const extended = initial.provides(
        Injectable("service", [CONTAINER] as const, (c: typeof initial) => c.get("value") * 2)
      );
      expect(extended.get("service")).toBe(20);
    });

    test("after a fork with an override, $container resolves through the forked child", () => {
      const parent = Container.providesValue("value", 1).provides(
        Injectable("service", [CONTAINER] as const, (c: any) => c.get("value") * 10)
      );
      // Fork an override without first resolving on the parent.
      const child = parent.providesValue("value", 5);
      expect(child.get("service")).toBe(50);
    });
  });

  describe("when token names collide with Object.prototype properties", () => {
    test("registered tokens that shadow Object.prototype methods resolve correctly", () => {
      const c = Container.providesValue("toString", "custom-toString")
        .providesValue("hasOwnProperty", 42)
        .providesValue("constructor", "fake-ctor");
      expect(c.get("toString")).toBe("custom-toString");
      expect(c.get("hasOwnProperty")).toBe(42);
      expect(c.get("constructor")).toBe("fake-ctor");
    });

    test("unregistered tokens that match Object.prototype methods still throw", () => {
      // Without the null-prototype root, `c.factories.toString` would return
      // Object.prototype.toString and silently invoke it instead of throwing.
      const c = Container.providesValue("foo", 1) as Container<any>;
      expect(() => c.get("toString")).toThrowError(/Could not find Service for Token "toString"/);
      expect(() => c.get("constructor")).toThrowError(/Could not find Service for Token "constructor"/);
    });
  });

  describe("on a deep dependency chain", () => {
    test("resolves a 100-deep linear chain to the correct values", () => {
      const SIZE = 100;
      let c: Container<any> = Container.providesValue("v0", 0);
      for (let i = 1; i <= SIZE; i++) {
        c = c.provides(`v${i}`, [`v${i - 1}`] as const, (prev: number) => prev + 1);
      }
      expect(c.get(`v${SIZE}`)).toBe(SIZE);
      // Re-resolve a shallow service after the deep walk to confirm memoization stays distinct.
      expect(c.get("v0")).toBe(0);
      expect(c.get("v50")).toBe(50);
    });
  });

  describe("overrides", () => {
    test("overriding value is supplied to the parent container function as a dependency", () => {
      let containerWithOverride = Container.providesValue("value", 1)
        .provides(Injectable("service", ["value"], (value: number) => value))
        .providesValue("value", 2);
      expect(containerWithOverride.get("service")).toBe(2);
    });

    test("overriding value is ignored when override happens after service was initialized", () => {
      let parentContainer = Container.providesValue("value", 1).provides(
        Injectable("service", ["value"], (value: number) => value)
      );

      expect(parentContainer.get("service")).toBe(1);

      let childContainerWithOverride = parentContainer.providesValue("value", 2);
      expect(childContainerWithOverride.get("service")).toBe(1);
    });

    test("forking a child does not change the parent's view of its services", () => {
      // The parent must remain a self-consistent snapshot: resolving a service via the parent
      // continues to use the parent's own dependencies, regardless of overrides applied in a
      // forked child.
      const parent = Container.providesValue("value", 1).provides(
        Injectable("service", ["value"], (value: number) => value)
      );
      // Fork a child with an override; do NOT resolve anything on the child before reading from
      // the parent. (Once a shared factory is resolved by any container, subsequent reads return
      // the memoized value — sibling isolation requires copy(['token']).)
      parent.providesValue("value", 2);
      expect(parent.get("service")).toBe(1);
      expect(parent.get("value")).toBe(1);
    });

    test("overriding with a different type changes resulting container's type", () => {
      const parentContainer = Container.providesValue("value", 1);
      let childContainerWithOverride = parentContainer.providesValue("value", "two");

      // @ts-expect-error should be failing to compile as the type of the container has changed
      let numberValue: number = childContainerWithOverride.get("value");

      let value: string = childContainerWithOverride.get("value");
      expect(value).toBe("two");

      const partialContainer = new PartialContainer({}).provides(Injectable("value", () => "three"));
      childContainerWithOverride = parentContainer.provides(partialContainer);
      value = childContainerWithOverride.get("value");
      expect(value).toBe("three");

      let extraContainer = Container.fromObject({ value: "four" });
      childContainerWithOverride = parentContainer.provides(extraContainer);
      value = childContainerWithOverride.get("value");
      expect(value).toBe("four");
    });
  });

  describe("when making a copy of the Container", () => {
    let injectable: InjectableFunction<any, [], "TestService", Date>;
    let containerWithService: Container<{ TestService: Date }>;

    beforeEach(() => {
      injectable = mockInjectable(Injectable("TestService", () => new Date()));
      containerWithService = container.provides(injectable);
    });

    test("the new Container resolves the same Token to the same Service instance", () => {
      const copy = containerWithService.copy();
      expect(copy.get("TestService")).toBeInstanceOf(Date);
      expect(copy.get("TestService")).toBe(containerWithService.get("TestService"));

      // The InjectableFunction is called once (in the source Container), and the result is shared with the copied
      // Container.
      expect(injectable).toBeCalledTimes(1);
    });

    test("the new Container re-creates Services which are scoped to the copy", () => {
      const copy = containerWithService.copy(["TestService"]);
      expect(copy.get("TestService")).toBeInstanceOf(Date);
      expect(copy.get("TestService")).not.toBe(containerWithService.get("TestService"));

      // The InjectableFunction was used to create a separate Service instance for each Container.
      expect(injectable).toBeCalledTimes(2);
    });

    test("scoped copy on a deeply chained container produces a fresh memoization", () => {
      // Bury the scoped service deep in a chain to exercise prototype-chain copy semantics.
      let counter = 0;
      let c: Container<any> = Container.providesValue("base", 1);
      for (let i = 0; i < 50; i++) c = c.providesValue(`pad${i}`, i);
      c = c.provides("counter", () => ++counter);
      for (let i = 0; i < 50; i++) c = c.providesValue(`tail${i}`, i);

      const originalValue = c.get("counter");
      const copy = c.copy(["counter"]);
      const copiedValue = copy.get("counter");

      expect(originalValue).toBe(1);
      expect(copiedValue).toBe(2);
      // Original's memoization is untouched.
      expect(c.get("counter")).toBe(1);
      // Non-scoped, inherited services still share memoization with the original.
      expect(copy.get("tail10")).toBe(c.get("tail10"));
    });
  });

  describe("when running a Service", () => {
    let injectable: InjectableFunction<any, [], "TestService", Date>;

    beforeEach(() => {
      injectable = mockInjectable(Injectable("TestService", () => new Date()));
    });

    test("the Service factory function is invoked.", () => {
      container.run(injectable);
      expect(injectable).toBeCalledTimes(1);
    });
  });

  describe("when accessing factories", () => {
    test("direct invocation of factories[token] works for services with dependencies", () => {
      // Pre-PR-#19, memoized factories carried `thisArg`, so calling a factory directly
      // (bypassing `get()`) still resolved its dependencies through the container.
      // Consumers using the public `factories` map should not see `this.get is not a
      // function` from a dependent service.
      const c = Container.providesValue("dep", 42).provides("svc", ["dep"] as const, (d: number) => d * 2);
      expect(c.factories.svc()).toBe(84);
    });

    test("Object.keys returns every registered token regardless of chain depth", () => {
      // Public `factories` exposes a flat own-property view; internal chain extension via
      // Object.create stays an implementation detail.
      const c = Container.providesValue("a", 1).providesValue("b", 2).providesValue("c", 3);
      expect(Object.keys(c.factories).sort()).toEqual(["a", "b", "c"]);
    });

    test("the factories are returned", () => {
      let c = container.providesValue("service", "value");
      expect(c.factories.service()).toEqual("value");
    });
  });

  describe("when constructed with raw, non-memoized factories", () => {
    test("the constructor memoizes them and resolution works", () => {
      // Exercises the constructor's slow path — internal builders feed pre-memoized factories,
      // so this path is only hit when the constructor is called directly with raw functions.
      const raw = { a: () => 1, b: () => "two" };
      const c = new Container(raw);
      expect(c.get("a")).toBe(1);
      expect(c.get("b")).toBe("two");
    });

    test("memoization holds across repeated gets", () => {
      const factory = jest.fn(() => ({}));
      const c = new Container({ thing: factory });
      const first = c.get("thing");
      const second = c.get("thing");
      expect(first).toBe(second);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    test("passes through already-memoized own factories on the slow path", () => {
      // Slow path is entered because `raw` has at least one non-memoized own factory; the
      // already-memoized `memoized` own factory must be preserved as-is.
      const memoized = Container.providesValue("first", 1).factories.first;
      const mixed = { first: memoized, second: () => 2 };
      const c: Container<{ first: number; second: number }> = new Container(mixed);
      expect(c.get("first")).toBe(1);
      expect(c.get("second")).toBe(2);
    });

    test("memoizes both own and inherited factories of a chained input", () => {
      // The constructor must memoize EVERY enumerable factory it sees — own and inherited —
      // otherwise inherited raw functions stay un-memoized (broken singleton semantics) and
      // their `.delegate` is undefined (breaks `copy(['token'])`).
      const sharedCount = { calls: 0 };
      const protoLike: Record<string, () => unknown> = {
        inherited: () => {
          sharedCount.calls += 1;
          return "inherited-value";
        },
      };
      const child = Object.create(protoLike) as Record<string, () => unknown>;
      child.fresh = () => "fresh-value";
      const c = new Container(child) as Container<{ inherited: string; fresh: string }>;

      // Resolution works for both, and the inherited factory is memoized (called once even
      // across multiple resolutions and a scoped copy).
      expect(c.get("fresh")).toBe("fresh-value");
      expect(c.get("inherited")).toBe("inherited-value");
      expect(c.get("inherited")).toBe("inherited-value");
      expect(sharedCount.calls).toBe(1);

      // copy(['inherited']) requires the inherited factory to be memoized so it has a
      // `.delegate` to un-memoize.
      const scoped = c.copy(["inherited"]);
      expect(scoped.get("inherited")).toBe("inherited-value");
      // Fresh memoization on the copy means the delegate ran once more.
      expect(sharedCount.calls).toBe(2);
    });
  });

  describe("when running a PartialContainer", () => {
    let service1: InjectableFunction<any, [], "Service1", string>;
    let service2: InjectableFunction<any, [], "Service2", number>;
    let partialContainer: PartialContainer<{ Service1: string; Service2: number }>;

    beforeEach(() => {
      service1 = mockInjectable(Injectable("Service1", () => "service1"));
      service2 = mockInjectable(Injectable("Service2", () => 42));
      partialContainer = new PartialContainer({}).provides(service1).provides(service2);
    });

    test("all factory functions in the PartialContainer are invoked", () => {
      container.run(partialContainer);
      expect(service1).toBeCalledTimes(1);
      expect(service2).toBeCalledTimes(1);
    });
  });
});
