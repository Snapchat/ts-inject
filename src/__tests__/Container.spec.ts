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
    test("the factories are returned", () => {
      let c = container.providesValue("service", "value");
      expect(c.factories.service()).toEqual("value");
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
