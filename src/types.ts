import type { Container, ContainerToken } from "./Container";

type AsTuple<T> = T extends readonly any[] ? T : never;

type CorrespondingService<Services, Token extends ValidTokens<Services>> = Token extends ContainerToken
  ? Container<Services>
  : Token extends keyof Services
    ? Services[Token]
    : never;

/**
 * Token type for associating services in a container, supporting strings, numbers, or symbols.
 */
export type TokenType = string | number | symbol;

/**
 * Given a Services object, the valid Tokens are simply the keys of that object or the special Container Token.
 */
export type ValidTokens<Services> = ContainerToken | keyof Services;

/**
 * Given Services, map from a list of Tokens to a list of Service types.
 */
export type CorrespondingServices<Services, Tokens extends readonly ValidTokens<Services>[]> = {
  [K in keyof Tokens]: Tokens[K] extends ValidTokens<Services> ? CorrespondingService<Services, Tokens[K]> : never;
};

/**
 * A valid `InjectableFunction` is one that can be successfully called, given some Services, to return a new Service.
 * That is, it must satisfy two conditions:
 *
 *   1. All the Tokens it specifies as dependencies are valid given the Services (i.e. they are either the Container
 *   Token or keys of the Services type).
 *   2. The function argument types correspond to the Services specified by the dependency Tokens.
 *
 * A `InjectableFunction` also includes its own key Token and dependency Tokens as metadata, so it may be resolved by
 * Container<Services> later.
 */
// `"$container" | keyof Services` is spelled out instead of `ValidTokens<Services>` on purpose, and the literal can't
// be replaced with `typeof CONTAINER` or `ContainerToken` either. Inside a type alias, TypeScript defers an array type
// whose element has to be looked up (through another alias or a `typeof` query), and re-instantiates it together with
// the alias's outer type arguments every time this conditional is evaluated. When Services is a long chain that
// contains an anonymous object-literal or function type, that re-walks every layer and exceeds the instantiation depth
// limit (see AddService). With a literal element type the array is resolved once. Kept in sync with CONTAINER by a
// test in types.spec.ts.
export type InjectableFunction<Services, Tokens, Token extends TokenType, Service> = Tokens extends readonly (
  | "$container"
  | keyof Services
)[]
  ? {
      (...args: AsTuple<CorrespondingServices<Services, Tokens>>): Service;
      token: Token;
      dependencies: Tokens;
    }
  : never;

/**
 * Represents a class that can be used as an injectable service within a dependency injection {@link Container}.
 * The `InjectableClass` type ensures that the class's dependencies and constructor signature align with
 * the services available in the container, providing strong type safety.
 */
// See InjectableFunction for why the element type is spelled out.
export type InjectableClass<Services, Service, Tokens> = Tokens extends readonly ("$container" | keyof Services)[]
  ? {
      readonly dependencies: Tokens;
      new (...args: AsTuple<CorrespondingServices<Services, Tokens>>): Service;
    }
  : never;

export type AnyInjectable = InjectableFunction<any, readonly TokenType[], TokenType, any>;

/**
 * Maps an array of {@link InjectableFunction} to a service type object, where each key is the token of an
 * {@link Injectable}, and the corresponding value is the return type of that {@link Injectable}.
 *
 * This utility type is useful for deriving the service types provided by a collection of {@link InjectableFunction}s,
 * ensuring type safety and consistency throughout your application.
 *
 * You can use `ServicesFromInjectables` to construct a type that serves as a type parameter for a {@link Container},
 * allowing the container's type to accurately reflect the services it provides,
 * even before the container is constructed.
 *
 * @typeParam Injectables - A tuple of {@link InjectableFunction}s.
 *
 * @example
 * // Define some Injectable functions
 * const injectable1 = Injectable("Service1", () => "service1");
 * const injectable2 = Injectable("Service2", () => 42);
 *
 * // Collect them in a tuple
 * const injectables = [injectable1, injectable2] as const;
 *
 * // Use ServicesFromInjectables to derive the services' types
 * type Services = ServicesFromInjectables<typeof injectables>;
 *
 * // Services type is equivalent to:
 * // {
 * //   Service1: string;
 * //   Service2: number;
 * // }
 *
 * // Declare a container variable with the derived Services type
 * // This allows us to reference the container with accurate typing before it's constructed,
 * // ensuring type safety and enabling its use in type annotations elsewhere
 * let container: Container<Services>;
 *
 * // Assign the container with the actual instance
 * container = Container.provides(injectable1).provides(injectable2);
 */
export type ServicesFromInjectables<Injectables extends readonly AnyInjectable[]> = {
  [Name in Injectables[number]["token"]]: ReturnType<Extract<Injectables[number], { token: Name }>>;
};

/**
 * Add a Service with a Token to an existing set of Services.
 */
// The outer conditional keeps the alias distributive over union Services (each member gets the new token). The inner
// one does two jobs. It forces TS language services to evaluate the type, so type hints show the
// mapped type instead of the AddService alias. And indexing `ParentServices[keyof ParentServices]` in the check type
// makes TS resolve every property of the parent eagerly. Without that, each layer's properties are resolved lazily
// through the layer below, so a chain of ~50 registrations exceeds TS's instantiation depth limit (TS2589) the first
// time a service is read.
export type AddService<ParentServices, Token extends TokenType, Service> = ParentServices extends unknown
  ? [ParentServices[keyof ParentServices]] extends [unknown]
    ? // A mapped type produces better, more concise type hints than an intersection type.
      {
        [K in keyof ParentServices | Token]: K extends keyof ParentServices
          ? K extends Token
            ? Service
            : ParentServices[K]
          : Service;
      }
    : never
  : never;

/**
 * Same as AddService above, but is merging multiple services at once. Services types override those of the parent.
 */
// See AddService for why the check types index into the parent and incoming services.
export type AddServices<ParentServices, Services> = ParentServices extends unknown
  ? Services extends unknown
    ? [ParentServices[keyof ParentServices]] extends [unknown]
      ? [Services[keyof Services]] extends [unknown]
        ? {
            [K in keyof Services | keyof ParentServices]: K extends keyof Services
              ? Services[K]
              : K extends keyof ParentServices
                ? ParentServices[K]
                : never;
          }
        : never
      : never
    : never
  : never;

/**
 * Create an object type from two tuples of the same length. The first tuple contains the object keys and the
 * second contains the value types corresponding to those keys.
 *
 * Ex:
 * ```ts
 * type FooBar = ServicesFromTokenizedParams<['foo', 'bar'], [string, number]>
 * const foobar: FooBar = {foo: 'foo', bar: 1}
 * const badfoobar: FooBar = {foo: 1, bar: 'bar'} // any extra, missing, or mis-typed properties raise an error.
 * ```
 */
export type ServicesFromTokenizedParams<Tokens, Params> = Tokens extends readonly []
  ? Params extends readonly []
    ? {}
    : never
  : Tokens extends readonly [infer Token, ...infer RemainingTokens]
    ? Params extends readonly [infer Param, ...infer RemainingParams]
      ? Tokens["length"] extends Params["length"]
        ? Token extends ContainerToken
          ? Param extends Container<infer S>
            ? S & ServicesFromTokenizedParams<RemainingTokens, RemainingParams>
            : never
          : Token extends TokenType
            ? { [K in Token]: Param extends Container<infer S> ? S : Param } & ServicesFromTokenizedParams<
                RemainingTokens,
                RemainingParams
              >
            : never
        : never
      : never
    : never;
