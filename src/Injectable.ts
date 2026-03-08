import type { InjectableClass, InjectableFunction, ServicesFromTokenizedParams, TokenType } from "./types";

/** Sentinel type used to produce readable compiler errors when factory param count doesn't match deps. */
export type ParamCountMismatch =
  "Error: factory parameter count must match dependency count" & { readonly __brand: unique symbol };

/**
 * Creates a reusable Injectable factory function designed for services without dependencies.
 *
 * **Note:** In most cases, prefer using `provides('token', () => value)` directly on
 * Container or PartialContainer instead. `Injectable()` is primarily needed when you want
 * a reusable factory object — for example, to pass to {@link Container.run | Container.run()}.
 *
 * @example
 * ```ts
 * // Prefer the inline form:
 * const container = Container.provides("MyService", () => new MyService());
 *
 * // Use Injectable() when you need a reusable factory:
 * const myServiceFactory = Injectable("MyService", () => new MyService());
 * container.run(myServiceFactory); // eager initialization
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
 * **Important:** This function requires **TypeScript 5 or later** due to the use of `const` type parameters.
 * Users on TypeScript 4 and earlier must use {@link InjectableCompat} instead.
 *
 * **Note:** In most cases, prefer the inline form on Container or PartialContainer:
 * `provides('token', ['dep'] as const, (dep) => value)`.
 *
 * @example
 * ```ts
 * // Prefer the inline form:
 * const container = Container
 *   .providesValue("DependencyA", new A())
 *   .providesValue("DependencyB", new B())
 *   .provides("MyService", ["DependencyA", "DependencyB"] as const, (a: A, b: B) => new MyService(a, b));
 *
 * // Use Injectable() when you need a reusable factory object:
 * const myServiceFactory = Injectable(
 *   "MyService", ["DependencyA", "DependencyB"] as const, (a: A, b: B) => new MyService(a, b)
 * );
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
  // force a compiler error via the ParamCountMismatch sentinel type. We'll also throw at runtime.
  fn: (...args: Tokens["length"] extends Params["length"] ? Params : ParamCountMismatch[]) => Service
): InjectableFunction<ServicesFromTokenizedParams<Tokens, Params>, Tokens, Token, Service>;

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
 * A compatibility version of {@link Injectable} for TypeScript 4 and earlier users.
 * This function behaves identically to {@link Injectable} but requires the use of `as const` on the dependencies array.
 *
 * @deprecated Use {@link Injectable} instead. This function is provided for compatibility with TypeScript 4
 * and earlier versions and will be removed in future releases.
 *
 * @see {@link Injectable} for detailed usage instructions and examples.
 */
export function InjectableCompat<
  Token extends TokenType,
  Tokens extends readonly TokenType[],
  Params extends readonly any[],
  Service,
>(
  token: Token,
  dependencies: Tokens,
  fn: (...args: Tokens["length"] extends Params["length"] ? Params : ParamCountMismatch[]) => Service
): ReturnType<typeof Injectable> {
  return Injectable(token, dependencies, fn);
}

/**
 * Creates an Injectable factory function for an InjectableClass.
 *
 * @example
 * ```ts
 * class Logger {
 *   static dependencies = ["config"] as const;
 *   constructor(private config: string) {}
 *   public print() {
 *     console.log(this.config);
 *   }
 * }
 *
 * const container = Container
 *   .providesValue("config", "value")
 *   .provides(ClassInjectable("logger", Logger));
 *
 * container.get("logger").print(); // prints "value"
 * ```
 *
 * It is recommended to use the `Container.provideClass()` method. The example above is equivalent to:
 * ```ts
 * const container = Container
 *   .providesValue("config", "value")
 *   .providesClass("logger", Logger);
 * container.get("logger").print(); // prints "value"
 * ```
 *
 * @param token Token identifying the Service.
 * @param cls InjectableClass to instantiate.
 */
export function ClassInjectable<
  Class extends InjectableClass<any, any, any>,
  Dependencies extends ConstructorParameters<Class>,
  Token extends TokenType,
  Tokens extends Class["dependencies"],
>(
  token: Token,
  cls: Class
): InjectableFunction<ServicesFromTokenizedParams<Tokens, Dependencies>, Tokens, Token, ConstructorReturnType<Class>>;

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
 * **Note:** Prefer using `container.append('token', () => value)` or
 * `container.appendValue('token', value)` instead.
 *
 * @example
 * ```ts
 * // Prefer the inline form:
 * const container = Container
 *   .providesValue("values", [1])
 *   .append("values", () => 2);
 *
 * // ConcatInjectable is the lower-level primitive:
 * const container2 = Container
 *   .providesValue("values", [1])
 *   .provides(ConcatInjectable("values", () => 2));
 *
 * // Both result in container.get("values") === [1, 2]
 * ```
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
  fn: (...args: Tokens["length"] extends Params["length"] ? Params : ParamCountMismatch[]) => Service
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

export type ConstructorReturnType<T> = T extends new (...args: any) => infer C ? C : any;
