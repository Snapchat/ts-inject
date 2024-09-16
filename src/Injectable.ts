import type { InjectableClass, InjectableFunction, ServicesFromTokenizedParams, TokenType } from "./types";

/**
 * Creates an Injectable factory function designed for services without dependencies.
 * This is useful for simple services or values that don't depend on other parts of the system.
 *
 * @example
 * ```ts
 * const container = Container.provides(Injectable("MyService", () => new MyService()));
 *
 * const myService = container.get("MyService");
 * ```
 *
 * @param token A unique Token identifying the Service within the container. This token
 *              is used to retrieve the instance from the container.
 * @param fn A zero-argument function that initializes and returns the Service instance.
 *           This can be any class instance, primitive, or complex value meant to be managed
 *           within the DI container.
 */
export function Injectable<Token extends TokenType, Service>(
  token: Token,
  fn: () => Service
): InjectableFunction<any, [], Token, Service>;

/**
 * Creates an Injectable factory function that requires dependencies.
 *
 * The dependencies are specified as tokens, and the factory function
 * will receive these dependencies as arguments in the order they are listed.
 *
 * **Note:** Dependencies must be specified as constant literals to allow TypeScript to ensure type safety.
 *
 * **Note:** Starting with TypeScript version 5, the `as const` assertion in the example below is not needed
 * due to the introduction of [const type parameters feature](
 * https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters).
 *
 * @example
 * ```ts
 * const dependencyB = 'DependencyB';
 * const container = Container
 *   .providesValue("DependencyA", new A())
 *   .providesValue("DependencyB", new B())
 *   .provides(Injectable(
 *     "MyService",
 *     ["DependencyA", dependencyB] as const, // "as const" can be omitted in TypeScript 5 and later
 *     (a: A, b: B) => new MyService(a, b),
 *   )
 * )
 *
 * const myService = container.get("MyService");
 * ```
 *
 * @param token A unique Token identifying the Service within the container.
 * @param dependencies A *readonly* array of Tokens representing the dependencies required by the factory function.
 * These will be resolved by the container and provided as arguments to the factory function.
 * @param fn A factory function whose parameters match the dependencies. This function should initialize and
 * return an instance of the Service. The types and number of its parameters must exactly match the dependencies.
 */
export function Injectable<
  Token extends TokenType,
  const Tokens extends readonly TokenType[],
  Params extends readonly any[],
  Service,
>(
  token: Token,
  dependencies: Tokens,
  // The function arity (number of arguments) must match the number of dependencies specified – if they don't, we'll
  // force a compiler error by saying the arguments should be `void[]`. We'll also throw at runtime, so the return
  // type will be `never`.
  fn: (...args: Tokens["length"] extends Params["length"] ? Params : void[]) => Service
): Tokens["length"] extends Params["length"]
  ? InjectableFunction<ServicesFromTokenizedParams<Tokens, Params>, Tokens, Token, Service>
  : never;

export function Injectable(
  token: TokenType,
  dependenciesOrFn?: readonly TokenType[] | (() => any),
  maybeFn?: (...args: any[]) => any
): InjectableFunction<any, readonly TokenType[], TokenType, any> {
  const dependencies: TokenType[] = Array.isArray(dependenciesOrFn) ? dependenciesOrFn : [];
  const fn = typeof dependenciesOrFn === "function" ? dependenciesOrFn : maybeFn;

  if (!fn) {
    throw new TypeError(
      "[Injectable] Received invalid arguments. The factory function must be either the second " + "or third argument."
    );
  }

  if (fn.length !== dependencies.length) {
    throw new TypeError(
      "[Injectable] Function arity does not match the number of dependencies. Function has arity " +
        `${fn.length}, but ${dependencies.length} dependencies were specified.` +
        `\nDependencies: ${JSON.stringify(dependencies)}`
    );
  }

  const factory = (...args: any[]) => fn(...args);
  factory.token = token;
  factory.dependencies = dependencies;
  return factory;
}

/**
 * Creates an Injectable factory function for an InjectableClass.
 *
 * @example
 * ```ts
 * class InjectableClassService {
 *     static dependencies = ["service"] as const;
 *     constructor(public service: string) {}
 *     public print(): string {
 *          console.log(this.service);
 *     }
 * }
 *
 * let container = Container.provides("service", "service value")
 *      .provides(ClassInjectable("classService", InjectableClassService));
 *
 * container.get("classService").print(); // prints "service value"
 *
 * // prefer using Container's provideClass method. Above is the equivalent of:
 * container = Container.provides("service", "service value")
 *     .providesClass("classService", InjectableClassService);
 *
 * container.get("classService").print(); // prints "service value"
 * ```
 *
 * @param token Token identifying the Service.
 * @param cls InjectableClass to instantiate.
 */
export function ClassInjectable<Services, Token extends TokenType, const Tokens extends readonly TokenType[], Service>(
  token: Token,
  cls: InjectableClass<Services, Service, Tokens>
): InjectableFunction<Services, Tokens, Token, Service>;

export function ClassInjectable(
  token: TokenType,
  cls: InjectableClass<any, any, readonly TokenType[]>
): InjectableFunction<any, readonly TokenType[], TokenType, any> {
  const factory = (...args: any[]) => new cls(...args);
  factory.token = token;
  factory.dependencies = cls.dependencies;
  return factory;
}

/**
 * Creates an Injectable factory function without dependencies that appends a Service
 * to an existing array of Services of the same type. Useful for dynamically expanding
 * service collections without altering original service tokens or factories.
 *
 * @example
 * ```ts
 * const container = Container
 *   .providesValue("values", [1]) // Initially provide an array with one value
 *   .provides(ConcatInjectable("values", () => 2)); // Append another value to the array
 *
 * const result = container.get("values"); // Results in [1, 2]
 * ```
 *
 * In this context, `ConcatInjectable("values", () => 2)` acts as a simplified form of
 * `Injectable("values", ["values"], (values: number[]) => [...values, 2])`,
 * directly appending a new value to the "values" service array without the need for explicit array manipulation.
 *
 * @param token Token identifying an existing Service array to which the new Service will be appended.
 * @param fn A no-argument function that returns the service to be appended.
 */
export function ConcatInjectable<Token extends TokenType, Service>(
  token: Token,
  fn: () => Service
): InjectableFunction<{ [T in keyof Token]: Service[] }, [], Token, Service[]>;

/**
 * Creates an Injectable factory function with dependencies that appends a Service
 * to an existing array of Services of the same type. This variant supports services
 * that require other services to be instantiated, allowing for more complex setups.
 *
 * @example
 * ```ts
 * const container = Container
 *   .providesValue("two", 2)
 *   .providesValue("values", [1]) // Initially provide an array with one value
 *   .provides(ConcatInjectable("values", ["two"] as const, (two: number) => two)); // Append another value to the array
 *
 * const result = container.get("values"); // [1, 2]
 * ```
 *
 * @param token Token identifying an existing Service array to append the new Service to.
 * @param dependencies Read-only list of Tokens for dependencies required by the factory function.
 * @param fn Factory function returning the Service to append.
 * The types and number of its parameters must exactly match the dependencies.
 */
export function ConcatInjectable<
  Token extends TokenType,
  const Tokens extends readonly TokenType[],
  Params extends readonly any[],
  Service,
>(
  token: Token,
  dependencies: Tokens,
  fn: (...args: Tokens["length"] extends Params["length"] ? Params : void[]) => Service
): InjectableFunction<ServicesFromTokenizedParams<Tokens, Params>, Tokens, Token, Service[]>;

export function ConcatInjectable(
  token: TokenType,
  dependenciesOrFn?: readonly TokenType[] | (() => any),
  maybeFn?: (...args: any[]) => any
): InjectableFunction<any, readonly TokenType[], TokenType, any[]> {
  const dependencies: TokenType[] = Array.isArray(dependenciesOrFn) ? dependenciesOrFn : [];
  const fn = typeof dependenciesOrFn === "function" ? dependenciesOrFn : maybeFn;

  if (!fn) {
    throw new TypeError(
      "[ConcatInjectable] Received invalid arguments. The factory function must be either the second " +
        "or third argument."
    );
  }

  if (fn.length !== dependencies.length) {
    throw new TypeError(
      "[Injectable] Function arity does not match the number of dependencies. Function has arity " +
        `${fn.length}, but ${dependencies.length} dependencies were specified.` +
        `\nDependencies: ${JSON.stringify(dependencies)}`
    );
  }

  const factory = (array: any[], ...args: any[]) => {
    return array.concat(fn(...args));
  };
  factory.token = token;
  factory.dependencies = [token, ...dependencies];
  return factory;
}
