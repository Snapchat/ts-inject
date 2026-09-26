/* eslint-disable max-classes-per-file */
import { ClassInjectable, Injectable } from "../Injectable";
import type { AddService, AddServices, ServicesFromInjectables } from "../types";
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
  // https://github.com/Snapchat/ts-inject/issues/27
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

  // The type-level Chain helper above skips the method-call path, so this compiles the issue's literal repro
  // shape as well. Below ~50 registrations the old types passed, so 60 keeps a margin above the old limit.
  test("a literal Container.fromObject({}) chain of 60 registrations compiles and reads back", () => {
    const container = Container.fromObject({})
      .providesValue("s0", 0)
      .providesValue("s1", 1)
      .providesValue("s2", 2)
      .providesValue("s3", 3)
      .providesValue("s4", 4)
      .providesValue("s5", 5)
      .providesValue("s6", 6)
      .providesValue("s7", 7)
      .providesValue("s8", 8)
      .providesValue("s9", 9)
      .providesValue("s10", 10)
      .providesValue("s11", 11)
      .providesValue("s12", 12)
      .providesValue("s13", 13)
      .providesValue("s14", 14)
      .providesValue("s15", 15)
      .providesValue("s16", 16)
      .providesValue("s17", 17)
      .providesValue("s18", 18)
      .providesValue("s19", 19)
      .providesValue("s20", 20)
      .providesValue("s21", 21)
      .providesValue("s22", 22)
      .providesValue("s23", 23)
      .providesValue("s24", 24)
      .providesValue("s25", 25)
      .providesValue("s26", 26)
      .providesValue("s27", 27)
      .providesValue("s28", 28)
      .providesValue("s29", 29)
      .providesValue("s30", 30)
      .providesValue("s31", 31)
      .providesValue("s32", 32)
      .providesValue("s33", 33)
      .providesValue("s34", 34)
      .providesValue("s35", 35)
      .providesValue("s36", 36)
      .providesValue("s37", 37)
      .providesValue("s38", 38)
      .providesValue("s39", 39)
      .providesValue("s40", 40)
      .providesValue("s41", 41)
      .providesValue("s42", 42)
      .providesValue("s43", 43)
      .providesValue("s44", 44)
      .providesValue("s45", 45)
      .providesValue("s46", 46)
      .providesValue("s47", 47)
      .providesValue("s48", 48)
      .providesValue("s49", 49)
      .providesValue("s50", 50)
      .providesValue("s51", 51)
      .providesValue("s52", 52)
      .providesValue("s53", 53)
      .providesValue("s54", 54)
      .providesValue("s55", 55)
      .providesValue("s56", 56)
      .providesValue("s57", 57)
      .providesValue("s58", 58)
      .providesValue("s59", 59);

    const first: number = container.get("s0");
    const last: number = container.get("s59");

    expect([first, last]).toEqual([0, 59]);
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
