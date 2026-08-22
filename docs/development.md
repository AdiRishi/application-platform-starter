# Development

## Requirements

- Node.js 24
- pnpm 11 through Corepack
- a Cloudflare account for Alchemy login and deployed stages

Copy `infra/.env.example` to `infra/.env`, set the account ID, and run
`pnpm --filter @repo/infra exec alchemy login --configure` if Alchemy does not
already have a session. Turborepo passes `CLOUDFLARE_*` and `ALCHEMY_*`
variables through without hashing their values into its cache.

## Commands

`pnpm dev` starts the complete Alchemy development stack. It builds the shared
contracts first, then runs both Workers, the web application, D1, R2, Queues,
and Durable Objects with local development resources.

`pnpm test` runs focused package tests and a Workerd integration test. The
processor test sends a queue message through real local D1, R2, and Durable
Object bindings.

`pnpm plan` prints the production infrastructure changes. It does not apply
them. `pnpm deploy` applies the production stage after Alchemy confirms the
plan.

## Repository tasks

Run `pnpm rename <kebab-case-name>` once when starting a project. It changes the
root package name, Alchemy stack name, Cloudflare resource prefix, and README
title.

Run `pnpm sync:repos` from a clean tree after changing the Effect version in
`pnpm-workspace.yaml`. The command updates `.repos/effect` to the matching git
tag as a squashed subtree.
