/* eslint-disable max-classes-per-file */
import { ClassInjectable, Injectable } from "../Injectable";
import type { ServicesFromInjectables } from "../types";
import { Container } from "../Container";
import { PartialContainer } from "../PartialContainer";

describe("ServicesFromInjectables", () => {
  test("correctly maps injectables to service types and allow container type definition before construction.", () => {
    const injectable1 = Injectable("Service1", () => "service1");
    const injectable2 = Injectable("Service2", () => 42);

    const injectables = [injectable1, injectable2] as const;

    // Use ServicesFromInjectables to derive the services' types
    type Services = ServicesFromInjectables<typeof injectables>;

    // Services type is equivalent to:
    // {
    //   Service1: string;
    //   Service2: number;
    // }

    // Declare a container variable with the derived Services type
    // This allows us to reference the container with accurate typing before it's constructed,
    // ensuring type safety and enabling its use in type annotations elsewhere
    let container: Container<Services>;

    // Assign the container with the actual instance
    container = Container.provides(injectable1).provides(injectable2);

    // Retrieve services with accurate typing
    const service1 = container.get("Service1"); // Type: string
    const service2 = container.get("Service2"); // Type: number

    // @ts-expect-error
    expect(() => container.get("NonExistentService")).toThrow();

    // @ts-expect-error
    const invalidService1: number = container.get("Service1");
    // @ts-expect-error
    const invalidService2: string = container.get("Service2");

    // Use the services
    expect(service1).toBe("service1");
    expect(service2).toBe(42);
  });

  test("handles injectables with dependencies and allow pre-definition of container type", () => {
    const injectableDep = Injectable("DepService", () => 100);
    const injectableMain = Injectable("MainService", ["DepService"] as const, (dep: number) => dep + 1);

    const injectables = [injectableDep, injectableMain] as const;

    type Services = ServicesFromInjectables<typeof injectables>;

    let container: Container<Services>;

    container = Container.provides(injectableDep).provides(injectableMain);

    expect(container.get("DepService")).toBe(100);
    expect(container.get("MainService")).toBe(101);
  });

  test("enforces type safety when assigning services.", () => {
    const injectable1 = Injectable("Service1", () => "service1");
    const injectable2 = Injectable("Service2", () => 42);

    const injectables = [injectable1, injectable2] as const;

    type Services = ServicesFromInjectables<typeof injectables>;

    // Correct assignment
    const services: Services = {
      Service1: "service1",
      Service2: 42,
    };

    // Attempting incorrect assignments should result in TypeScript errors

    const invalidServices1: Services = {
      Service1: "service1",
      // @ts-expect-error
      Service2: "not a number", // Error: Type 'string' is not assignable to type 'number'
    };

    const invalidServices2: Services = {
      // @ts-expect-error
      Service1: 123, // Error: Type 'number' is not assignable to type 'string'
      Service2: 42,
    };

    // @ts-expect-error
    const invalidServices3: Services = {
      Service1: "service1",
      // Missing 'Service2' property
    };

    // avoid the "unused variable" TypeScript error
    expect(services ?? invalidServices1 ?? invalidServices2 ?? invalidServices3).toBeDefined();
  });
});

describe("lazy class registration types", () => {
  test("infers services and validates dependencies for eager and lazy forms", () => {
    class Dependency {
      value = 42;
    }

    class Service {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: Dependency) {}
    }

    const base = Container.providesValue("dependency", new Dependency());
    const eager = base.providesClass("eager", Service);
    const lazy = base.providesClass("lazy", () => Service);
    const eagerService: Service = eager.get("eager");
    const lazyService: Service = lazy.get("lazy");

    const lowLevel = ClassInjectable("lowLevel", () => Service);
    const fromLowLevel = base.provides(lowLevel);
    const lowLevelService: Service = fromLowLevel.get("lowLevel");

    const partial = new PartialContainer({}).providesClass("partial", () => Service);
    const fromPartial = base.provides(partial);
    const partialService: Service = fromPartial.get("partial");

    interface Plugin {
      dependency: Dependency;
    }
    class PluginImpl implements Plugin {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: Dependency) {}
    }
    const withPlugin = base.providesValue("plugins", [] as Plugin[]).appendClass("plugins", () => PluginImpl);
    const plugins: Plugin[] = withPlugin.get("plugins");

    expect(
      eagerService.dependency.value +
        lazyService.dependency.value +
        lowLevelService.dependency.value +
        partialService.dependency.value +
        plugins[0].dependency.value
    ).toBe(210);
  });

  test("rejects missing, mismatched, and non-array-element lazy classes", () => {
    class Dependency {}

    class MissingDependencyService {
      static dependencies = ["missing"] as const;

      constructor(public missing: number) {}
    }

    class WrongDependencyTypeService {
      static dependencies = ["dependency"] as const;

      constructor(public dependency: string) {}
    }

    class WrongArityService {
      static dependencies = ["dependency"] as const;

      constructor(
        public dependency: Dependency,
        public extra: number
      ) {}
    }

    const base = Container.providesValue("dependency", new Dependency());

    // @ts-expect-error "missing" is not registered in the direct Container
    base.providesClass("missing", () => MissingDependencyService);
    // @ts-expect-error constructor parameter is string, but "dependency" resolves to Dependency
    base.providesClass("wrongType", () => WrongDependencyTypeService);
    // @ts-expect-error constructor arity does not match the dependency tuple
    base.providesClass("wrongArity", () => WrongArityService);
    const unresolvedPartial = new PartialContainer({}).providesClass("missing", () => MissingDependencyService);
    // @ts-expect-error the PartialContainer's "missing" dependency has not been fulfilled
    Container.provides(unresolvedPartial);
    // @ts-expect-error the PartialContainer requires "missing" to be a number
    Container.providesValue("missing", "wrong type").provides(unresolvedPartial);
    Container.providesValue("missing", 1).provides(unresolvedPartial);

    interface Plugin {
      run(): void;
    }
    class NotAPlugin {
      static dependencies = [] as const;
      value = 1;
    }
    const plugins = base.providesValue("plugins", [] as Plugin[]);
    // @ts-expect-error NotAPlugin is not assignable to the array's Plugin element type
    plugins.appendClass("plugins", () => NotAPlugin);

    const invalidLowLevel = ClassInjectable("wrongLowLevel", () => WrongDependencyTypeService);
    // @ts-expect-error low-level lazy ClassInjectable retains dependency type validation
    base.provides(invalidLowLevel);

    expect(base.get("dependency")).toBeInstanceOf(Dependency);
  });
});
