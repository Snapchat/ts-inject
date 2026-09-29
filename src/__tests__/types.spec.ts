/* eslint-disable max-classes-per-file */
import { ClassInjectable, Injectable } from "../Injectable";
import type { AddService, AddServices, ServicesFromInjectables } from "../types";
import { CONTAINER, Container } from "../Container";
import type { ContainerToken } from "../Container";
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

// Builds the type a chain of N `providesValue` calls produces, without writing N lines of source.
type Chain<
  N extends number,
  Prefix extends string = "s",
  Services = {},
  Acc extends unknown[] = [],
> = Acc["length"] extends N
  ? Services
  : Chain<N, Prefix, AddService<Services, `${Prefix}${Acc["length"]}`, number>, [...Acc, 0]>;

describe("AddService", () => {
  test("reading from a chain of 120 registrations does not exceed TS's instantiation depth limit", () => {
    let container: Container<{}> = Container.fromObject({});
    for (let i = 0; i < 120; i++) container = container.providesValue(`s${i}`, i) as Container<{}>;
    const deep = container as Container<Chain<120>>;

    // Before the fix each of these statements failed with TS2589 "Type instantiation is excessively deep".
    const first: number = deep.get("s0");
    const last: number = deep.get("s119");
    const sum: number = deep.provides("sum", ["s0", "s119"] as const, (a, b) => a + b).get("sum");

    expect([first, last, sum]).toEqual([0, 119, 119]);
  });
});

describe("AddServices", () => {
  test("merging 8 modules of 60 registrations does not exceed TS's instantiation depth limit", () => {
    type Merged<N extends number, Services = {}, Acc extends unknown[] = []> = Acc["length"] extends N
      ? Services
      : Merged<N, AddServices<Services, Chain<60, `m${Acc["length"]}_`>>, [...Acc, 0]>;

    let container: Container<{}> = Container.fromObject({});
    for (let m = 0; m < 8; m++) {
      let module: PartialContainer<{}, {}> = PartialContainer.fromObject({});
      for (let i = 0; i < 60; i++) module = module.providesValue(`m${m}_${i}`, i) as PartialContainer<{}, {}>;
      container = container.provides(module);
    }
    const merged = container as Container<Merged<8>>;

    const first: number = merged.get("m0_0");
    const last: number = merged.get("m7_59");

    expect([first, last]).toEqual([0, 59]);
  });
});

describe("explicit type arguments", () => {
  test("callers can still widen a service type at registration", () => {
    const widened = Container.providesValue("a", 1)
      .providesValue<"b", number | undefined>("b", 1)
      .provides<"c", string | null>("c", () => "x");
    const a: number = widened.get<"a">("a");
    const b: number | undefined = widened.get("b");
    const c: string | null = widened.get("c");
    // @ts-expect-error "b" was registered as number | undefined
    const narrowed: number = widened.get("b");

    const partial = PartialContainer.fromObject({}).providesValue<"p", string | null>("p", "x");
    const p: string | null = Container.provides(partial).get("p");

    expect([a, b, c, p]).toEqual([1, 1, "x", "x"]);
  });
});

describe("receiver-typed methods", () => {
  const partial = new PartialContainer({}).provides("len", ["dep"] as const, (dep: string) => dep.length);
  const container = Container.providesValue("dep", "abc");

  test("explicit type arguments on provides(partial) and run(partial) keep their original order", () => {
    const withExtra = container.providesValue("extra", 1);
    const merged = withExtra.provides<{ len: number }, { dep: string }, { dep: string }>(partial);
    const ran = withExtra.run<{ len: number }, { dep: string }, { dep: string }>(partial);
    expect(() =>
      // @ts-expect-error "dep" is not provided
      Container.providesValue("other", 1).run(partial)
    ).toThrow();
    // The receiver's other services survive explicit type arguments.
    expect([merged.get("len"), merged.get("extra"), ran.get("dep"), ran.get("extra")]).toEqual([3, 1, "abc", 1]);
  });

  test("methods stay fully typed through facade types and after bind", () => {
    const facade: Pick<Container<{ dep: string }>, "get" | "provides" | "providesValue"> = container;
    const bound = container.get.bind(container);
    const next = container.providesValue.bind(container)("z", 1);
    const viaFacade = facade.provides("w", () => true);
    const z: number = next.get("z");
    const w: boolean = viaFacade.get("w");
    expect(() =>
      // @ts-expect-error a bound method keeps the registered tokens
      next.get("tpyo")
    ).toThrow();
    expect(() =>
      // @ts-expect-error a facade call keeps the registered tokens
      viaFacade.get("tpyo")
    ).toThrow();
    const boundPartial = partial.providesValue.bind(partial)("q", 1);
    const q: number = container.provides(boundPartial).get("q");
    expect([facade.get("dep"), bound("dep"), z, w, q]).toEqual(["abc", "abc", 1, true, 1]);
  });

  test("run returns the receiver's own type", () => {
    class Tagged extends Container<{ dep: string }> {
      tag() {
        return "tagged";
      }
    }
    const tagged = new Tagged({ dep: () => "abc" });
    const init = Injectable("init", ["dep"] as const, (dep: string) => dep.length);
    const afterPartial: Tagged = tagged.run(partial);
    const afterFn: Tagged = tagged.run(init);
    const explicitPartial: Tagged = tagged.run<{ len: number }, { dep: string }, { dep: string }>(partial);
    const explicitFn: Tagged = tagged.run<"init", readonly ["dep"], number>(init);
    expect([afterPartial.tag(), afterFn.tag(), explicitPartial.tag(), explicitFn.tag()]).toEqual([
      "tagged",
      "tagged",
      "tagged",
      "tagged",
    ]);
  });
});

describe("container token", () => {
  test("the token spelled out in InjectableFunction and InjectableClass matches CONTAINER", () => {
    const spelledOut: ContainerToken = "$container";
    const constant: "$container" = CONTAINER;
    expect(spelledOut).toBe(constant);
  });
});
