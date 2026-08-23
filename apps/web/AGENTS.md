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

Alchemy injects the Cloudflare Vite integration during development and
deployment. Do not add `@cloudflare/vite-plugin` or another deployment adapter
to `vite.config.ts`.
