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

- `src/routes/` contains file-based routes and colocated route tests.
- `src/components/ui/` contains shadcn/ui primitives.
- `src/lib/` contains app providers, utilities, and the deferred Cloudflare
  environment proxy.
- `src/routeTree.gen.ts` is generated. Do not edit it.

Alchemy injects the Cloudflare Vite integration during development and
deployment. Do not add `@cloudflare/vite-plugin` or another deployment adapter
to `vite.config.ts`.
