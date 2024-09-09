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
// Logger service definition
class Logger {
  log(message: string) {
    console.log(`Log: ${message}`);
  }
}

// Database service depends on Logger
class Database {
  constructor(private logger: Logger) {}

  save(record: string) {
    this.logger.log(`Saving record: ${record}`);
    // Assume record saving logic here
  }
}
```

#### Setting Up the Container

With `ts-inject`, you can easily set up a container to manage these services:

```ts
import { Container, Injectable } from "@snap/ts-inject";

// Define Injectable factory functions for services
const loggerFactory = Injectable("Logger", () => new Logger());
const databaseFactory = Injectable("Database", ["Logger"] as const, (logger: Logger) => new Database(logger));

// Create a container and register services
const container = Container.provides(loggerFactory).provides(databaseFactory);

// Now, retrieve the Database service from the container
const db = container.get("Database");
db.save("user1"); // Log: Saving record: user1
```

#### Composable Containers

`ts-inject` supports composable containers, allowing you to modularize service registration:

```ts
const baseContainer = Container.provides(loggerFactory);
const appContainer = Container.provides(baseContainer).provide(databaseFactory);

const db: Database = appContainer.get("Database");
db.save("user2"); // Log: Saving record: user2
```

### Key Concepts

- **Container**: A registry for all services, handling their creation and retrieval.
- **PartialContainer**: Similar to a Container but allows services to be registered without defining all dependencies upfront. Unlike a regular Container, it does not support retrieving services directly.
- **Service**: Any value or instance provided by the Container.
- **Token**: A unique identifier for each service, used for registration and retrieval within the Container.
- **InjectableFunction**: Functions that return service instances. They can include dependencies which are injected when the service is requested.
- **InjectableClass**: Classes that can be instantiated by the Container. Dependencies should be specified in a static "dependencies" field to enable proper injection.

### API Reference

For comprehensive documentation of all ts-inject features and APIs, please refer to the [API Reference](https://snapchat.github.io/ts-inject/).

## Contributing

[Contributing guide](CONTRIBUTING.md).

## License

`ts-inject` is published under [MIT license](LICENSE.md).

## Project Origins

`ts-inject` originated as an internal project at [Snap Inc.](https://snap.com/), developed by [Weston Fribley](https://github.com/wfribley). Inspired by the principles of [typed-inject](https://github.com/nicojs/typed-inject), it was designed to address the limitations of existing dependency injection frameworks and improve typesafe dependency resolution in TypeScript. Initially aimed at enhancing [CameraKit](https://www.npmjs.com/package/@snap/camera-kit)'s codebase, its success led to its adoption across various teams at [Snap Inc.](https://snap.com/), and now it has evolved into an open-source project to benefit the wider TypeScript community.
