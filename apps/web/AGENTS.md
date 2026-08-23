# Web application

## Commands

```bash
pnpm dev
pnpm --filter @repo/web build
pnpm --filter @repo/web test
pnpm --filter @repo/web typecheck
pnpm --filter @repo/web check
```

Run development through the root Alchemy stack so Cloudflare bindings are
available to TanStack's server runtime.

## Architecture

This is a TanStack Start application using React 19 and Vite. TanStack Router
provides file-based routing, and `@tanstack/react-router-ssr-query` integrates
TanStack Query with SSR.

- `src/routes/` contains file-based routes.
- `src/features/<feature>/` owns server functions, Query options, and server-only
  access for one application feature.
- `tests/` mirrors `src/` and contains React Testing Library tests and setup.
- `src/components/ui/` contains shadcn/ui primitives.
- `src/lib/` contains framework-independent leaf utilities. Do not put feature
  APIs or application services there.
- `src/routeTree.gen.ts` is generated. Do not edit it.

Use `createServerFn` for structured browser-to-server calls. Put those exports
in `*.functions.ts`, their reusable `queryOptions` in `*.queries.ts`, and all
Cloudflare binding access in `*.server.ts` modules guarded by
`@tanstack/react-start/server-only`. Route loaders seed the Query cache with
the same query options that components consume. Use a specific server route
when the browser needs a raw `Response`, such as a download or webhook. Do not
add a catch-all API proxy or a custom server entry for ordinary data access.

Alchemy injects the Cloudflare Vite integration during development and
deployment. Do not add `@cloudflare/vite-plugin` or another deployment adapter
to `vite.config.ts`.
