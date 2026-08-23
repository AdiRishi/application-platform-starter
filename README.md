# Application Platform Starter

A TypeScript monorepo for Cloudflare applications that have outgrown one Worker and one web app.

Use this starter when one Cloudflare project needs several web applications, service Workers, background processors, queues, databases, buckets, Durable Objects, or other resources that depend on one another. [Alchemy](https://alchemy.run/) is the organizing layer. It turns that topology into one typed program for local development, tests, and production.

The repository starts with one web application, two Workers, and a representative data plane. That resource count is an example, not a constraint. Add more runtimes and services by extending the same graph.

## What this starter solves

A small Cloudflare project can keep its deployment details in one configuration file. That approach becomes hard to reason about when the system grows across many runtimes and resources.

This starter keeps the complete platform in one place:

- Alchemy creates resources in dependency order and passes their outputs directly to the runtimes that need them.
- Worker bindings are declared once in [`infra/src/worker-bindings.ts`](infra/src/worker-bindings.ts), then inferred as TypeScript environment types.
- Runtime-to-runtime traffic uses service bindings instead of exposing internal Workers at public URLs.
- Runtimes do not maintain separate Wrangler configurations. The Alchemy program owns their resources, bindings, and deployment settings.
- Stages isolate local development, production, and deployed tests with deterministic resource names.
- `alchemy dev` runs the Worker graph in workerd with local implementations of D1, R2, Queues, and Durable Objects.
- A shared contracts package defines data and failures that cross runtime boundaries.
- Turborepo coordinates builds, type checks, and tests across every workspace.

The result is a repository where adding another Worker or data service extends the existing graph. It does not create another disconnected deployment setup.

## The infrastructure graph

[`infra/alchemy.run.ts`](infra/alchemy.run.ts) is the entry point for the platform. It composes small infrastructure modules and passes provisioned resources forward as typed values:

```mermaid
flowchart LR
  Stack[alchemy.run.ts] --> Config[Deployment config]
  Stack --> Data[Data plane]
  Stack --> Workers[Worker graph]
  Stack --> Web[Web applications]
  Config --> Data
  Data --> Workers
  Workers --> Web
  Bindings[worker-bindings.ts] -. typed bindings .-> Workers
  Bindings -. typed bindings .-> Web
```

The current graph has three layers:

1. [`infra/src/data-plane.ts`](infra/src/data-plane.ts) creates shared state and messaging resources.
2. [`infra/src/workers.ts`](infra/src/workers.ts) creates internal Workers and connects them to the data plane and to one another.
3. [`infra/src/web-application.ts`](infra/src/web-application.ts) creates the public application and binds it to the internal Worker graph.

[`infra/src/deployment-config.ts`](infra/src/deployment-config.ts) selects stage behavior. [`infra/src/resource-names.ts`](infra/src/resource-names.ts) gives every resource a project and stage-specific name.

This order is intentional. A downstream runtime receives the actual resource object created upstream, so its binding, identifier, and TypeScript type stay connected. When the platform grows, add another focused infrastructure module and compose it from the same entry point.

## What is included

- A TanStack Start web application with React, TanStack Router, TanStack Query, Tailwind CSS, and shadcn components
- Separate API and background processor Worker workspaces
- D1, R2, Queue, dead-letter queue, Durable Object, Worker, and Website resources managed by Alchemy
- Typed Worker service bindings and Effect RPC transport
- Shared Effect schemas and tagged failures in `@repo/contracts`
- Local Worker integration tests with Cloudflare's Vitest pool
- A live infrastructure test that deploys and destroys an isolated Cloudflare stage
- pnpm workspaces, Turborepo, TypeScript, Oxlint, Oxfmt, and repository-specific lint rules
- A version-matched Effect source subtree for checking APIs and project idioms

## Create a project from the starter

You need Node.js 24, Corepack, and a Cloudflare account.

Create a new project without this repository's Git history:

```sh
npx degit AdiRishi/application-platform-starter acme-platform
cd acme-platform
corepack enable
pnpm install
```

Rename the starter before you change its structure:

```sh
pnpm rename acme-platform
pnpm install
```

The rename command accepts a kebab-case name. It updates the root package name, the Alchemy stack name, the Cloudflare resource prefix, and the README heading. Run it once on a fresh copy. The second install refreshes `pnpm-lock.yaml` with the new package name.

Start the complete platform:

```sh
pnpm dev
```

Alchemy prints the local web URL when the stack is ready.

## Work locally

Run development from the repository root:

```sh
pnpm dev
```

The root command compiles internal packages, starts the Alchemy `dev` stage, provisions local resources, launches each Worker in workerd, and starts the web development server with its bindings attached.

Do not start the web workspace with Vite alone. The application expects bindings supplied by the Alchemy stack.

On the first run, Alchemy may ask you to authenticate with Cloudflare so it can initialize its state store. Resources with local implementations still run on your machine. For non-interactive authentication, use the variables documented in [`infra/.env.example`](infra/.env.example).

## Grow the platform

The existing web application and Workers are examples of how to connect deployables. Add or replace them to match your system.

To add a runtime or resource:

1. Add the application under `apps/*` or the Worker under `workers/*`.
2. Define shared schemas, failures, and RPCs in [`packages/contracts`](packages/contracts).
3. Create the required Cloudflare resources in a focused module under [`infra/src`](infra/src).
4. Add each runtime binding to [`infra/src/worker-bindings.ts`](infra/src/worker-bindings.ts).
5. Compose the new module into [`infra/alchemy.run.ts`](infra/alchemy.run.ts) and pass real resource outputs to its consumers.
6. Add deterministic names to [`infra/src/resource-names.ts`](infra/src/resource-names.ts).
7. Cover local behavior through the runtime's public interface. Add a live infrastructure test when the behavior depends on deployed Cloudflare resources.

Keep deployment topology in `infra/`. Individual runtimes consume bindings; they do not duplicate the platform configuration.

## Project map

| Path                                       | Responsibility                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| [`apps/*`](apps)                           | Public web applications and their server runtimes                           |
| [`workers/*`](workers)                     | APIs, processors, queue consumers, and other Worker services                |
| [`packages/contracts`](packages/contracts) | Schemas, errors, RPC definitions, and transport shared across runtimes      |
| [`infra`](infra)                           | The Alchemy program, resource graph, bindings, stages, and deployment tests |
| [`migrations`](migrations)                 | D1 schema migrations                                                        |
| [`tooling`](tooling)                       | Shared TypeScript configuration and repository-specific lint rules          |
| [`scripts`](scripts)                       | Project rename and reference repository tooling                             |
| [`.repos/effect`](.repos/effect)           | Read-only Effect source matched to the workspace version                    |
| [`docs/adr`](docs/adr)                     | Decisions that govern repository structure and test layout                  |

The pnpm workspace discovers new projects through `apps/*`, `workers/*`, and `packages/*`. Most new runtimes need no root package manifest changes.

## Stages

The repository supports three stage shapes:

| Stage          | Command                         | Purpose                                              |
| -------------- | ------------------------------- | ---------------------------------------------------- |
| `dev`          | `pnpm dev`                      | Local Workers and local data service implementations |
| `prod`         | `pnpm plan`, then `pnpm deploy` | Production resources in Cloudflare                   |
| `test-<8 hex>` | `pnpm test:infra-live`          | Isolated live resources created for one test run     |

Production names use the project prefix directly. Development and test resources add their stage to the prefix, which prevents one environment from reusing another environment's resources.

## Test the platform

Run the local validation suite before you commit:

```sh
pnpm check
pnpm typecheck
pnpm test
```

`pnpm test` does not create cloud resources. Worker integration tests run against in-process D1, R2, Queue, Durable Object, and service bindings. React tests exercise the web application through visible behavior.

Use the live suite when you change infrastructure or behavior that depends on a real deployment:

```sh
pnpm test:infra-live
```

The live harness creates a unique `test-*` stage, deploys the full stack, tests it through the public application, and destroys the stage after the suite.

Tests live in a separate `tests/` directory that mirrors each workspace's `src/` tree. Read [the test layout decision](docs/adr/0001-mirror-tests-in-a-tests-directory.mdx) before changing the test setup.

## Deploy to Cloudflare

Review the production plan:

```sh
pnpm plan
```

Alchemy prompts for Cloudflare authentication when no saved profile is available. In CI, provide `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Deploy the `prod` stage after you review the plan:

```sh
pnpm deploy
```

The deployment command applies the complete resource graph and prints the public application URL returned by the stack.

## Commands

Root scripts are the public interface for routine work:

| Command                | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`             | Run the full local platform with hot reload                               |
| `pnpm compile`         | Compile shared packages in dependency order                               |
| `pnpm build`           | Compile packages and build every workspace                                |
| `pnpm check`           | Compile packages, run Oxlint, and check formatting                        |
| `pnpm fix`             | Fix lint and formatting errors that can be fixed automatically            |
| `pnpm typecheck`       | Type-check production and test projects across the monorepo               |
| `pnpm test`            | Run local tests across all workspaces                                     |
| `pnpm test:infra-live` | Deploy, test, and destroy an isolated live stage                          |
| `pnpm plan`            | Preview production infrastructure changes                                 |
| `pnpm deploy`          | Deploy the production stage                                               |
| `pnpm rename <name>`   | Replace the starter's project and infrastructure identity                 |
| `pnpm sync:repos`      | Sync source references to the dependency versions pinned by the workspace |

## About the reference application

The included application is a disposable proof that the platform works across a public web runtime, private Workers, shared state, asynchronous processing, failure recovery, and deployment. Keep it while you learn the repository, then replace it with your own runtimes and resources.
