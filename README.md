# Application Platform Starter

A small, complete Cloudflare application for projects that need more than one
backend. It profiles uploaded CSV files through a web application, an API
Worker, and an asynchronous processor Worker.

The example is deliberately narrow. Its job is to prove the repository shape,
typed Worker boundaries, queue recovery, state ownership, and infrastructure
deployment without leaving a fake product to delete.

## What is included

- TanStack Start web application
- API Worker connected to D1, R2, a Queue, and the processor Worker
- Processor Worker connected to D1, R2, the Queue, its dead-letter queue, and a
  Durable Object namespace
- Alchemy infrastructure program shared by local development and deployment
- Effect schemas and failures across package and Worker boundaries
- Turborepo, pnpm catalogs, Oxlint, Oxfmt, and a version-matched Effect subtree

## Start here

```sh
corepack enable
pnpm install
pnpm dev
```

Upload [`fixtures/transactions.csv`](./fixtures/transactions.csv) from the web
application. Alchemy prints the local URL after the stack starts.

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Read [`docs/architecture.md`](./docs/architecture.md) for the request path and
[`docs/development.md`](./docs/development.md) for local commands. Run
`pnpm rename my-project` before using the repository as a new project.
