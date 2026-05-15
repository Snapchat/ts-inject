# ts-inject

`ts-inject` is a 100% typesafe dependency injection framework for TypeScript projects, designed to enhance code sharing and modularity by ensuring compile-time dependency resolution. This framework leverages the dependency injection design pattern to decouple dependency usage from creation, allowing components to rely on interfaces rather than implementations.

## Features and Alternatives

`ts-inject` brings typesafety to dependency injection, setting it apart from a vast majority of frameworks, like [InversifyJS](https://github.com/inversify/InversifyJS), which operate at runtime and therefore lack this level of typesafety.

While [typed-inject](https://github.com/nicojs/typed-inject) also prioritizes typesafety, it lacks several key features that `ts-inject` offers:

- **Overcomes TypeScript Nested Type Limitations**: Unlike some frameworks, `ts-inject` navigates around [TypeScript's limits on nested types](https://github.com/nicojs/typed-inject/issues/22), making it more robust for complex applications.
- **Composable Containers**: `ts-inject` enables merging multiple containers, facilitating greater modularity and code reuse.
- **PartialContainer**: It allows service registration without pre-defined dependencies, offering more flexibility compared to regular containers.

## Getting Started

### Installation

```bash
npm install @snap/ts-inject
```

### Sample Usage

This quick start guide demonstrates how to define services, register them in a container, and then retrieve them for use.

#### Defining Services

Define a couple of services. For simplicity, we'll use a `Logger` service and a `Database` service, where `Database` depends on `Logger` for logging purposes.

```ts
class Logger {
  log(message: string) {
    console.log(`Log: ${message}`);
  }
}

class Database {
  static dependencies = ["Logger"] as const;
  constructor(private logger: Logger) {}

  save(record: string) {
    this.logger.log(`Saving record: ${record}`);
  }
}
```

#### Setting Up the Container

With `ts-inject`, you can set up a container to manage these services using `providesValue` and `providesClass`:

```ts
import { Container } from "@snap/ts-inject";

const container = Container.providesValue("Logger", new Logger()).providesClass("Database", Database);

const db = container.get("Database");
db.save("user1"); // Log: Saving record: user1
```

#### Inline Factory Functions

When a service needs custom creation logic, pass a factory function directly to `provides`:

```ts
import { Container } from "@snap/ts-inject";

// Zero-dependency lazy factory
const container = Container.provides("Logger", () => new Logger());

// Factory with dependencies — tokens are resolved from the container
const appContainer = container
  .providesValue("apiUrl", "https://api.example.com")
  .provides("httpClient", ["apiUrl"] as const, (url: string) => createHttpClient(url));
```

For most services, prefer `providesValue` (eager values), `providesClass` (classes with `static dependencies`), or the inline `provides` form above. The `Injectable()` helper is only needed when you need a reusable factory object — for example, to pass to `run()` for eager initialization.

#### Composable Containers

`ts-inject` supports composable containers, allowing you to modularize service registration:

```ts
const baseContainer = Container.providesValue("Logger", new Logger());
const appContainer = baseContainer.providesClass("Database", Database);

const db = appContainer.get("Database");
db.save("user2"); // Log: Saving record: user2
```

> **Note:** Each registration method (`provides`, `providesValue`, `providesClass`, etc.)
> returns a **new child container** — the original container is never modified.
> Always use the returned value; calls whose return value is discarded have no effect.

You can also bootstrap a container from a plain object with `fromObject`:

```ts
const configContainer = Container.fromObject({ apiUrl: "https://api.example.com", timeout: 5000 });
```

#### Multi-Binding

Containers support appending to array-typed services, useful for plugin systems and extensible pipelines:

```ts
const container = Container.providesValue("plugins", [] as Plugin[])
  .appendClass("plugins", AuthPlugin)
  .appendClass("plugins", LoggingPlugin)
  .appendValue("plugins", { name: "inline", run: () => {} });

container.get("plugins"); // [AuthPlugin, LoggingPlugin, { name: "inline", ... }]
```

#### Modular Multibindings: contributing across module boundaries

`appendClass` / `appendValue` work when one place owns the whole `Container` chain. They break down when you want **independent modules to contribute to the same registry without seeing each other** — the canonical plugin/middleware/extension shape. `ts-inject` solves this with `bind()` and `compose()`:

- `bind<Registry>()` starts a self-contained contribution against a registry shape (typically `typeof someContainer`, but a plain type alias works too).
- `.contributeValue` / `.contributeClass` / `.contribute` add entries to one of the registry's array tokens; dependencies declared by a class or `Injectable()` flow into the binding's phantom dependency type.
- `.build()` produces a `Multibinding<Registry, Deps>` — a portable value modules can export.
- `compose(core, ...bindings)` applies every binding in order, and the compiler verifies each binding's deps are present in `core`. Missing deps surface as a `missingDeps` field on the offending binding in the type error.

A typical layout:

```ts
// registry.ts — one place declares the shape of the extension points.
import { Container } from "@snap/ts-inject";

export interface Plugin { name: string; run(): void }

export const registry = Container
  .providesValue("plugins", [] as Plugin[])
  .providesValue("middlewares", [] as ((req: Request) => Request)[]);

export type Registry = typeof registry extends import("@snap/ts-inject").Container<infer S> ? S : never;
```

```ts
// auth/binding.ts — a module exports its contribution as a value.
import { bind } from "@snap/ts-inject";
import type { Registry } from "../registry";

class AuthPlugin {
  static dependencies = ["apiKey"] as const;
  readonly name = "auth";
  constructor(private apiKey: string) {}
  run() { /* ... */ }
}

export const authBinding = bind<Registry>()
  .contributeClass("plugins", AuthPlugin)   // requires `apiKey` from the core
  .build();
```

```ts
// metrics/binding.ts — pre-built Injectable() works the same way.
import { Injectable, bind } from "@snap/ts-inject";
import type { Registry } from "../registry";

const metricsPlugin = Injectable(
  "plugins",
  ["statsPrefix", "logger"] as const,
  (prefix: string, logger: Logger): Plugin => ({
    name: "metrics",
    run: () => logger.info(`${prefix}.requests`),
  })
);

export const metricsBinding = bind<Registry>().contribute(metricsPlugin).build();
```

```ts
// app.ts — wire-up site composes the core with every contribution.
import { compose } from "@snap/ts-inject";
import { registry } from "./registry";
import { authBinding } from "./auth/binding";
import { metricsBinding } from "./metrics/binding";

const core = registry
  .providesValue("apiKey", process.env.API_KEY!)
  .providesValue("statsPrefix", "app")
  .providesClass("logger", ConsoleLogger);

const app = compose(core, authBinding, metricsBinding);
app.get("plugins"); // [AuthPlugin instance, metrics plugin]
```

If `metricsBinding` needs `statsPrefix` and the core doesn't provide it, `compose` rejects the call at compile time — the error names the missing key, not just "type mismatch".

##### Private services with `withInternal`

A binding's contribution often needs a helper that isn't a registry entry — say, an `HttpPlugin` that takes a `RetryPolicy`. You have three options:

1. **Hard-code it** (`new RetryPolicy(3)` in the constructor). No DI, no config, no test seam.
2. **Add `retryPolicy` to the core container.** Now every other binding can see it, the core's service type lists it, and you've leaked one plugin's implementation detail into the global namespace.
3. **`withInternal`.** Attach a small `PartialContainer` of helpers that *only this binding's contributions* can see. The helper is properly DI-wired, but invisible to other bindings and to consumers of the composed container.

```ts
import { bind, PartialContainer } from "@snap/ts-inject";

const internal = new PartialContainer({}).provides(
  "retryPolicy",
  ["maxRetries"] as const,
  (n: number) => new RetryPolicy(n)
);

class HttpPlugin {
  static dependencies = ["retryPolicy", "endpoint"] as const;
  readonly name = "http";
  constructor(private retry: RetryPolicy, private endpoint: string) {}
  run() { /* ... */ }
}

export const httpBinding = bind<Registry>()
  .withInternal(internal)
  .contributeClass("plugins", HttpPlugin)
  .build();
```

**Dep-flow rule:** a binding requires whatever its contributions declare as deps, **minus** what `withInternal` provides, **plus** what `withInternal` itself depends on but doesn't provide. Above:

- `HttpPlugin` declares `["retryPolicy", "endpoint"]`.
- `withInternal` provides `retryPolicy`, and itself needs `maxRetries`.
- → `compose(core, httpBinding)` requires `{ endpoint, maxRetries }` from the core. `retryPolicy` is satisfied internally and doesn't appear.

The privacy is enforced on both axes: `compose`'s return type doesn't include `retryPolicy` (so `app.get("retryPolicy")` is a type error), and the helper is only resolvable inside this binding's apply step at runtime.

Chain `.withInternal(...)` **before** the contributions that depend on its services — the dep subtraction only sees what's been declared so far.

##### When to use which

| You want to…                                                                | Use                                       |
| --------------------------------------------------------------------------- | ----------------------------------------- |
| Append to an array in a `Container` you own end-to-end                      | `container.appendValue` / `appendClass`   |
| Let several modules independently extend a shared registry                  | `bind()` + `compose()`                    |
| Contribute a value with no DI                                               | `.contributeValue(token, value)`          |
| Contribute a class whose deps live in the core                              | `.contributeClass(token, MyClass)`        |
| Contribute a custom factory (closes over state, composes services manually) | `.contribute(Injectable(...))`            |
| Inject a helper that's an implementation detail of one binding              | `.withInternal(partialContainer)`         |

### Key Concepts

- **Container**: A registry for all services, handling their creation and retrieval.
- **PartialContainer**: Similar to a Container but allows services to be registered without defining all dependencies upfront. Unlike a regular Container, it does not support retrieving services directly.
- **Service**: Any value or instance provided by the Container.
- **Token**: A unique identifier for each service, used for registration and retrieval within the Container.
- **InjectableClass**: Classes that can be instantiated by the Container. Dependencies are specified in a static `dependencies` field to enable automatic injection via `providesClass`.
- **InjectableFunction**: A reusable factory object created by `Injectable()`. Rarely needed directly — prefer the inline `provides('token', factory)` form. Use `Injectable()` when you need to store or pass a factory to `run()`.
- **Multibinding**: A portable, type-branded contribution to a registry container's array-typed tokens, produced by `bind()` and applied via `compose()`. Lets independent modules extend a shared registry without sharing a Container chain.

### API Reference

For comprehensive documentation of all ts-inject features and APIs, please refer to the [API Reference](https://snapchat.github.io/ts-inject/).

## Contributing

[Contributing guide](CONTRIBUTING.md).

## License

`ts-inject` is published under [MIT license](LICENSE.md).

## Project Origins

`ts-inject` originated as an internal project at [Snap Inc.](https://snap.com/), developed by [Weston Fribley](https://github.com/wfribley). Inspired by the principles of [typed-inject](https://github.com/nicojs/typed-inject), it was designed to address the limitations of existing dependency injection frameworks and improve typesafe dependency resolution in TypeScript. Initially aimed at enhancing [CameraKit](https://www.npmjs.com/package/@snap/camera-kit)'s codebase, its success led to its adoption across various teams at [Snap Inc.](https://snap.com/), and now it has evolved into an open-source project to benefit the wider TypeScript community.
