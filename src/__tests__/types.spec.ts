import { Injectable } from "../Injectable";
import type { ServicesFromInjectables } from "../types";
import { Container } from "../Container";

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
