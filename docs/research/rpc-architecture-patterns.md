# RPC architecture patterns

This note records the repository comparison that preceded ADR 0002. References to the starter's old `processing-client.ts` and direct RPC handler describe the code before that decision was implemented.

## Recommendation

Keep Effect RPC over Cloudflare HTTP service bindings. Do not continue the current conversion shape.

The package is not forcing the hard-to-read code. The starter has put protocol adaptation inside one feature client, kept every contract in one barrel, and let the RPC handler call a Durable Object directly. Those choices collapse the transport, boundary, and application layers into the same path.

Use this request path instead:

```text
caller
  -> derived Effect RPC client
  -> one shared service-binding HTTP adapter
  -> capability RPC handler Layer
  -> capability Effect service
  -> repository or platform binding
```

Each part has one job:

- The contract declares the payload, success, and expected error Schemas.
- The handler translates the contract into a service call.
- The service owns application logic and depends on repositories or platform services through Effect.
- One shared adapter owns the fake origin, `/rpc`, JSON serialization, bound `fetch`, transport errors, the web handler, and request-scoped Cloudflare context.
- Each Worker entrypoint only composes contract groups, handler Layers, and the shared server adapter.

This keeps the properties that motivated Effect RPC. Callers get Effect-native results, typed failures, runtime validation, and derived clients. It also recovers the locality that made the Dhawal tRPC worker readable.

## What the comparison shows

| Repository                   | Pattern worth keeping                                                                                                                                                                                     | Limit or counterexample                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dhawal legacy                | One router file per domain, a small root router, a thin Fetch adapter, and a documented `router -> service -> repository` dependency direction. [D1] [D2] [D3]                                            | The current checkout does not declare output schemas on its procedures. It infers `RouterOutputs` from handlers, and a representative router only calls `.input(...)`. [D1] [D2] It also has one public API Worker, so it does not prove a worker-to-worker service-binding design. |
| Ironcage                     | Explicit payload, success, and error Schemas per operation; groups assembled by callable surface; one reusable client over a bound `fetch`; and one reusable server route. [I1] [I2] [I3] [I4]            | The core handler maps the whole operator surface in one `app-api.ts`. [I5] That is acceptable at its current size, but it is the same aggregation pressure to avoid here.                                                                                                           |
| T3 Code                      | Contract values live in domain files, RPC definitions reference explicit payload, success, and error Schemas, and substantial Effect services split their interface from their live Layer. [T1] [T2] [T3] | `packages/contracts/src/rpc.ts` is 1,085 lines and `apps/server/src/ws.ts` is 2,453 lines. The root group and the handler object have become catalogs for the whole product. [T1] [T4] This is evidence against one contract file and one handler file per Worker.                  |
| Application platform starter | Infrastructure already declares `website -> API` and `API -> processor` service bindings. The processor contract already has explicit payload, success, and error Schemas. [A1] [A2]                      | `processing-client.ts` hand-builds an Effect `HttpClient`, body conversion, request construction, and protocol Layer for one call. The processor handler then reaches straight into `PROFILE_SESSIONS`. [A3] [A4] The protocol is more visible than the use case.                   |

The Dhawal setup feels clean because it applies locality consistently. Its root router is only a list of domain routers, and each router calls separate service modules. tRPC contributes concise syntax, but the main benefit comes from the file and dependency boundaries. Dhawal does not provide the explicit output validation requested here.

Ironcage supplies the missing transport pattern. Its `httpClientOverBinding` adapts any structural service binding by providing `FetchHttpClient.Fetch` with `binding.fetch.bind(binding)`. Its `clientOverBinding` adds the fake origin, RPC protocol, serialization, and timeout once. [I3] The starter's `processing-client.ts` repeats this work with a custom request-body bridge for one client. [A3]

T3 Code proves that Effect services and Layers can keep application logic independent of RPC. `OrchestrationEngineService` declares the application interface, while `OrchestrationEngineLive` implements it elsewhere. [T2] [T3] Its RPC and WebSocket files also show what happens when every contract and handler is assembled in one file. Do not copy that part.

## Effect RPC supports capability-sized composition

Effect RPC does not require one `RpcGroup` or one handler object. The pinned source supports all of these operations:

- `RpcGroup.merge(...)` combines capability groups.
- `RpcGroup.toLayer(...)` implements one group as a Layer.
- `RpcGroup.toLayerHandler(...)` implements one operation when a group is too large for one handler module.
- `RpcServer.layerHttp(...)` registers the HTTP route and accepts the composed handler services. [E1] [E2]

The current server uses the lower-level `RpcServer.toHttpEffect(...)` and manually applies serialization and scope. [A4] Prefer `RpcServer.layerHttp({ group, path: "/rpc", protocol: "http" })` inside the shared server adapter. The Worker should not repeat that wiring.

## Proposed file layout

Keep code grouped by owned capability. Split by role inside each capability.

```text
packages/contracts/src/
  artifacts/
    schema.ts
    processor-rpcs.ts
  surfaces/
    processor.ts
    api.ts
  transport/
    client.ts
    server.ts
  client.ts
  schema.ts
  server.ts

workers/processor/src/
  index.ts
  artifacts/
    service.ts
    rpc.ts
    repository.ts
    profile-job.ts
    profile-session.ts
    profile-csv.ts
    errors.ts

workers/api/src/
  index.ts
  artifacts/
    service.ts
    rpc.ts
    processor-client.ts
    repository.ts
    http.ts
    errors.ts
```

`schema.ts` contains reusable values. `processor-rpcs.ts` declares the capability operations. `surfaces/processor.ts` merges the capability groups exposed by the processor Worker. The package entrypoints keep browser-safe schemas, caller helpers, and server helpers separate, following Ironcage's `schema`, `client`, and `server` exports. [I6]

`workers/processor/src/artifacts/service.ts` declares an Effect service such as `ArtifactProcessing`. Its live Layer depends on a narrow service for `PROFILE_SESSIONS`, rather than on `ProcessorEnv`. The service returns application errors. `artifacts/rpc.ts` contains a small handler Layer that maps those errors into contract errors.

`workers/api/src/artifacts/processor-client.ts` should be a thin service declaration or alias over the derived RPC client. It must not contain HTTP body handling. The shared `clientOverBinding` implementation owns that code and has at least two real consumers once the website Worker calls the API Worker through its binding.

The root `index.ts` files remain Cloudflare adapters. They assemble the surface group and handler Layers, then delegate to the shared web handler. They do not define routes, handlers, or application logic.

## Contract conventions

Use one visible definition for every operation:

```ts
export const getProcessingStateRpc = Rpc.make("artifacts.getProcessingState", {
  payload: { artifactId: ArtifactId },
  success: ProcessingState,
  error: GetProcessingStateError,
});
```

The operation name should include the capability. A reader can search for `artifacts.getProcessingState` and find the contract, handler, and service method without guessing which Worker owns it.

Define contract errors for failures a caller can act on. Keep D1, R2, Durable Object, protocol, and decode failures inside the service or transport adapter, then map them to a small boundary taxonomy. Ironcage's `intoTaxonomy` demonstrates this separation by converting `RpcClientError` into its public `Internal` error. [I3]

Do not put infrastructure details in contract errors. `ProcessorRpcFailure` currently exposes only a generic message, so it does not buy meaningful typed recovery. [A2] Either give the caller distinct actions such as `NotFound`, `Unavailable`, or `Conflict`, or map all non-actionable failures to one `Internal` error in the adapter.

Keep output Schemas even when TypeScript could infer the return type. Runtime output validation is one of the reasons to choose Effect RPC over the Dhawal tRPC shape.

## Service-binding rules

Treat the binding as the transport and Effect RPC as one protocol carried over it. Cloudflare supports calling a bound Worker's `fetch()` with a `Request`; the URL must be absolute when the caller constructs it. The request does not traverse a public URL. [C1] [C2]

Apply the topology as follows:

```text
browser -> TanStack Start server function -> env.API.fetch -> API Worker
API Worker -> env.PROCESSOR.fetch -> processor Worker
Worker -> Durable Object binding -> Durable Object method
Worker -> Queue binding -> schema-decoded message consumer
```

The browser cannot hold a Cloudflare service binding. "The web app uses service bindings" means that the web Worker's server-side code owns the binding call. Structured queries and commands can use the derived Effect RPC client there. Endpoints that need raw HTTP behavior, such as file uploads and downloads, may keep a specific `fetch` route while still crossing to the API Worker through `env.API.fetch`. Do not force binary bodies or streamed `Response` objects through JSON RPC only to make every call look identical.

Keep native Durable Object methods for object-local calls. They already have a single binding interface in `infra/src/worker-bindings.ts`. [A1] Effect RPC adds value at the Worker boundary because it supplies the shared runtime contract. It adds little between a Worker and a Durable Object owned by the same deployment.

## Migration order

1. Add the shared binding-backed `HttpClient`, Effect RPC client, and Effect RPC server adapters. Cover each adapter with one transport integration test.
2. Move artifact Schemas and `ProcessorRpcs` out of `packages/contracts/src/index.ts` into capability files and explicit package entrypoints.
3. Introduce the processor capability service. Move the `PROFILE_SESSIONS` call out of the RPC handler.
4. Replace `processing-client.ts` with the derived client plus the shared binding adapter.
5. Split additional Worker contracts and handlers by capability before converting more bindings.
6. Wire the website Worker to the API binding through the same adapter for structured calls. Keep raw file routes explicit.

Stop the broad conversion until steps 1 through 4 establish the pattern. One clean vertical slice is enough to judge the design. If that slice still needs feature-specific transport code, the shared adapter has the wrong boundary.

## Sources

- [A1] `/Users/arishi/playground/application-platform-starter/infra/src/worker-bindings.ts:7-44`
- [A2] `/Users/arishi/playground/application-platform-starter/packages/contracts/src/index.ts:126-149`
- [A3] `/Users/arishi/playground/application-platform-starter/workers/api/src/artifacts/processing-client.ts:1-52`
- [A4] `/Users/arishi/playground/application-platform-starter/workers/processor/src/artifacts/rpc.ts:1-25`
- [D1] `/Users/arishi/personal/dhawal-legacy/dhawal-ops-true-legacy/workers/ops-api/trpc/router.ts:1-52`
- [D2] `/Users/arishi/personal/dhawal-legacy/dhawal-ops-true-legacy/workers/ops-api/trpc/routers/products.ts:18-143`
- [D3] `/Users/arishi/personal/dhawal-legacy/dhawal-ops-true-legacy/docs/adr/0011-organize-code-by-locality-and-layer.md:68-104`
- [I1] `/Users/arishi/playground/ironcage/packages/contracts/src/surfaces/system.ts:12-40`
- [I2] `/Users/arishi/playground/ironcage/packages/contracts/src/surfaces/app.ts:1-57`
- [I3] `/Users/arishi/playground/ironcage/packages/contracts/src/transport/client.ts:9-130`
- [I4] `/Users/arishi/playground/ironcage/packages/contracts/src/transport/server.ts:1-22`
- [I5] `/Users/arishi/playground/ironcage/apps/core/src/app-api.ts:76-122`
- [I6] `/Users/arishi/playground/ironcage/packages/contracts/package.json:1-35`
- [T1] `/Users/arishi/forks/t3code/packages/contracts/src/rpc.ts:318-470,871-1085`
- [T2] `/Users/arishi/forks/t3code/apps/server/src/orchestration/Services/OrchestrationEngine.ts:1-89`
- [T3] `/Users/arishi/forks/t3code/apps/server/src/orchestration/Layers/OrchestrationEngine.ts:1-375`
- [T4] `/Users/arishi/forks/t3code/apps/server/src/ws.ts:383-430,1121-1175,2381-2445`
- [E1] `/Users/arishi/playground/application-platform-starter/.repos/effect/packages/effect/src/unstable/rpc/RpcGroup.ts:28-130`
- [E2] `/Users/arishi/playground/application-platform-starter/.repos/effect/packages/effect/src/unstable/rpc/RpcServer.ts:789-825`
- [C1] [Cloudflare Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [C2] [Cloudflare Service bindings over HTTP](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
