/* eslint-disable max-classes-per-file */
import { Container } from "../Container";
import { ClassInjectable, Injectable } from "../Injectable";
import { PartialContainer } from "../PartialContainer";

function makeModuleNamespace<T extends object>(exports: T): { namespace: T; reads: () => number } {
  let reads = 0;
  const namespace = new Proxy(exports, {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  return { namespace, reads: () => reads };
}

describe("lazy class registration", () => {
  test("direct Container registration defers dependency metadata for every injectable", () => {
    let dependencyReads = 0;
    const createService = jest.fn((dependency: string) => ({ dependency }));
    const injectable = Injectable("service", ["dependency"] as const, createService);
    Object.defineProperty(injectable, "dependencies", {
      enumerable: true,
      get: () => {
        dependencyReads += 1;
        return ["dependency"] as const;
      },
    });

    const container = Container.providesValue("dependency", "injected").provides(injectable);
    expect(dependencyReads).toBe(0);

    const first = container.get("service");
    const second = container.get("service");
    expect(first).toBe(second);
    expect(first.dependency).toBe("injected");
    expect(dependencyReads).toBe(1);
    expect(createService).toHaveBeenCalledTimes(1);
  });

  test("direct Container registration does not read the class until first resolution", () => {
    let constructorCalls = 0;
    class LazyService {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: string) {
        constructorCalls += 1;
      }
    }

    const { namespace, reads } = makeModuleNamespace({ LazyService });
    const getClass = jest.fn(() => namespace.LazyService);
    const container = Container.providesValue("dependency", "injected")
      .providesClass("service", getClass)
      .providesValue("unrelated", true);

    expect(reads()).toBe(0);
    expect(getClass).not.toHaveBeenCalled();
    expect(constructorCalls).toBe(0);

    const first = container.get("service");
    const second = container.get("service");

    expect(first).toBe(second);
    expect(first.dependency).toBe("injected");
    expect(reads()).toBe(1);
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(1);
  });

  test("PartialContainer registration and composition do not read the class", () => {
    let constructorCalls = 0;
    class LazyService {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: number) {
        constructorCalls += 1;
      }
    }

    const { namespace, reads } = makeModuleNamespace({ LazyService });
    const getClass = jest.fn(() => namespace.LazyService);
    const partial = new PartialContainer({}).providesClass("service", getClass);
    expect(reads()).toBe(0);

    const composedPartial = new PartialContainer({}).provides(partial);
    expect(reads()).toBe(0);

    const container = Container.providesValue("dependency", 42).provides(composedPartial);
    expect(reads()).toBe(0);
    expect(getClass).not.toHaveBeenCalled();

    const first = container.get("service");
    const second = container.get("service");
    expect(first).toBe(second);
    expect(first.dependency).toBe(42);
    expect(reads()).toBe(1);
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(1);
  });

  test("dependency metadata and construction use the same cached class", () => {
    class FirstService {
      static dependencies = ["firstDependency"] as const;

      constructor(public dependency: string) {}
    }

    class DifferentService {
      static dependencies = ["secondDependency"] as const;

      constructor(public dependency: string) {}
    }

    const getClass = jest
      .fn<typeof FirstService, []>()
      .mockReturnValueOnce(FirstService)
      .mockReturnValue(DifferentService as unknown as typeof FirstService);
    const container = Container.providesValue("firstDependency", "first")
      .providesValue("secondDependency", "second")
      .providesClass("service", getClass);

    const service = container.get("service");
    expect(service).toBeInstanceOf(FirstService);
    expect(service.dependency).toBe("first");
    expect(getClass).toHaveBeenCalledTimes(1);
  });

  test("the direct-class form retains eager metadata reads and normal memoization", () => {
    let dependencyReads = 0;
    let constructorCalls = 0;
    class EagerService {
      static get dependencies(): readonly ["dependency"] {
        dependencyReads += 1;
        return ["dependency"];
      }

      constructor(public dependency: string) {
        constructorCalls += 1;
      }
    }

    const container = Container.providesValue("dependency", "eager").providesClass("service", EagerService);
    expect(dependencyReads).toBe(1);
    expect(constructorCalls).toBe(0);

    expect(container.get("service").dependency).toBe("eager");
    expect(container.get("service").dependency).toBe("eager");
    expect(dependencyReads).toBe(1);
    expect(constructorCalls).toBe(1);
  });

  test("lazy classes retain override and self-dependency semantics", () => {
    class ReadsOverride {
      static dependencies = ["value"] as const;

      constructor(public value: number) {}
    }

    class WrapsService {
      static dependencies = ["service"] as const;

      constructor(public previous: string) {}
    }

    const withOverride = Container.providesValue("value", 1)
      .providesClass("service", () => ReadsOverride)
      .providesValue("value", 2);
    expect(withOverride.get("service").value).toBe(2);

    const withSelfDependency = Container.providesValue("service", "parent").providesClass(
      "service",
      () => WrapsService
    );
    expect(withSelfDependency.get("service").previous).toBe("parent");
  });

  test("lazy PartialContainer classes retain partial overrides and self-dependencies", () => {
    class ReadsOverride {
      static dependencies = ["value"] as const;

      constructor(public value: number) {}
    }

    class WrapsService {
      static dependencies = ["service"] as const;

      constructor(public previous: string) {}
    }

    const overridePartial = new PartialContainer({})
      .providesClass("service", () => ReadsOverride)
      .providesValue("value", 3);
    const withOverride = Container.providesValue("value", 1).provides(overridePartial);
    expect(withOverride.get("service").value).toBe(3);

    const selfPartial = new PartialContainer({}).providesClass("service", () => WrapsService);
    const withSelfDependency = Container.providesValue("service", "parent").provides(selfPartial);
    expect(withSelfDependency.get("service").previous).toBe("parent");
  });

  test("appendClass supports a lazy class provider", () => {
    interface Plugin {
      dependency: string;
    }

    let constructorCalls = 0;
    class LazyPlugin implements Plugin {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: string) {
        constructorCalls += 1;
      }
    }

    const { namespace, reads } = makeModuleNamespace({ LazyPlugin });
    const getClass = jest.fn(() => namespace.LazyPlugin);
    const container = Container.providesValue("dependency", "plugin dependency")
      .providesValue("plugins", [] as Plugin[])
      .appendClass("plugins", getClass);

    expect(reads()).toBe(0);
    expect(getClass).not.toHaveBeenCalled();

    const first = container.get("plugins");
    const second = container.get("plugins");
    expect(first).toBe(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toBeInstanceOf(LazyPlugin);
    expect(first[0].dependency).toBe("plugin dependency");
    expect(reads()).toBe(1);
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(1);
  });

  test("ClassInjectable supports the lazy form without direct Container registration reads", () => {
    class LazyService {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: string) {}
    }

    const { namespace, reads } = makeModuleNamespace({ LazyService });
    const injectable = ClassInjectable("service", () => namespace.LazyService);
    expect(reads()).toBe(0);

    const container = Container.providesValue("dependency", "low level").provides(injectable);
    expect(reads()).toBe(0);
    expect(container.get("service").dependency).toBe("low level");
    expect(reads()).toBe(1);
  });

  test("a throwing class provider is retried until it returns a constructor", () => {
    let constructorCalls = 0;
    class RetryService {
      static dependencies = [] as const;

      constructor() {
        constructorCalls += 1;
      }
    }

    const getClass = jest
      .fn<typeof RetryService, []>()
      .mockImplementationOnce(() => {
        throw new Error("module load failed");
      })
      .mockReturnValue(RetryService);
    const container = new Container({}).providesClass("service", getClass);

    expect(() => container.get("service")).toThrowError("module load failed");
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(0);

    const service = container.get("service");
    expect(service).toBeInstanceOf(RetryService);
    expect(container.get("service")).toBe(service);
    expect(getClass).toHaveBeenCalledTimes(2);
    expect(constructorCalls).toBe(1);
  });

  test("constructor failures retry construction without re-running a successful class provider", () => {
    let constructorCalls = 0;
    class RetryService {
      static dependencies = [] as const;

      constructor() {
        constructorCalls += 1;
        if (constructorCalls === 1) throw new Error("construction failed");
      }
    }

    const getClass = jest.fn(() => RetryService);
    const container = new Container({}).providesClass("service", getClass);

    expect(() => container.get("service")).toThrowError("construction failed");
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(1);

    const service = container.get("service");
    expect(service).toBeInstanceOf(RetryService);
    expect(container.get("service")).toBe(service);
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(2);
  });

  test("PartialContainer construction failures have the same retry and constructor-cache behavior", () => {
    let constructorCalls = 0;
    class RetryService {
      static dependencies = [] as const;

      constructor() {
        constructorCalls += 1;
        if (constructorCalls === 1) throw new Error("partial construction failed");
      }
    }

    const getClass = jest.fn(() => RetryService);
    const partial = new PartialContainer({}).providesClass("service", getClass);
    const container = Container.provides(partial);

    expect(() => container.get("service")).toThrowError("partial construction failed");
    const service = container.get("service");
    expect(service).toBeInstanceOf(RetryService);
    expect(container.get("service")).toBe(service);
    expect(getClass).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(2);
  });
});
