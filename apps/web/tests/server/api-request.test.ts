import { AppRequestError } from "@repo/contracts/app";
import { ArtifactId, ArtifactNotFound } from "@repo/contracts/artifacts";
import { ApiRpcs } from "@repo/contracts/artifacts/api";
import { withRpcClient } from "@repo/contracts/client";
import { rpcWebHandler } from "@repo/contracts/server";
import { isCancelledError } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { createQueryClient } from "@/lib/query-client";
import { runApiRequest } from "@/server/api-request";

const artifactId = Schema.decodeSync(ArtifactId)("28f31da1-a2ed-4f1f-a9d9-463107ad09f0");

test("transport failures do not disclose internal addresses or diagnostics", async () => {
  const request = withRpcClient(
    ApiRpcs,
    {
      binding: {
        fetch: async () => {
          throw new Error("private.service.internal: sensitive credentials");
        },
      },
      service: "private",
      timeout: "1 second",
    },
    (client) => client.listArtifacts(),
  );
  await expect(runApiRequest(request, new AbortController().signal)).rejects.toEqual(
    new AppRequestError("unavailable", "The service is temporarily unavailable. Please try again."),
  );
});

test("unexpected defects become safe internal errors", async () => {
  await expect(
    runApiRequest(Effect.die(new Error("private query")), new AbortController().signal),
  ).rejects.toEqual(new AppRequestError("internal", "The request could not be completed."));
});

test("cancelling a query interrupts RPC work instead of producing an application error", async () => {
  const started = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const server = rpcWebHandler(
    ApiRpcs,
    ApiRpcs.toLayer({
      getArtifact: () => Effect.fail(new ArtifactNotFound({ artifactId })),
      listArtifacts: () =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => stopped.resolve())),
        ),
    }),
  );
  const client = createQueryClient();
  try {
    const result = client
      .fetchQuery({
        queryKey: ["cancel"],
        queryFn: ({ signal }) =>
          runApiRequest(
            withRpcClient(
              ApiRpcs,
              {
                binding: { fetch: (input, init) => server.handler(new Request(input, init)) },
                service: "test",
                timeout: "2 seconds",
              },
              (rpc) => rpc.listArtifacts(),
            ),
            signal,
          ),
      })
      .catch((error: Error) => error);
    await started.promise;
    await client.cancelQueries({ queryKey: ["cancel"] });
    expect(isCancelledError(await result)).toBe(true);
    await stopped.promise;
  } finally {
    client.clear();
    await server.dispose();
  }
});

test("an expired RPC deadline becomes a retryable unavailable error", async () => {
  await expect(
    runApiRequest(Effect.never.pipe(Effect.timeout("20 millis")), new AbortController().signal),
  ).rejects.toEqual(
    new AppRequestError("unavailable", "The service is temporarily unavailable. Please try again."),
  );
});

test.each([
  { status: 503, body: "private gateway diagnostics", code: "unavailable" },
  { status: 200, body: "invalid RPC payload", code: "internal" },
  { status: 403, body: "private access policy", code: "internal" },
])("HTTP $status maps to $code without disclosing its response", async ({ status, body, code }) => {
  const request = withRpcClient(
    ApiRpcs,
    {
      binding: { fetch: async () => new Response(body, { status }) },
      service: "test",
      timeout: "1 second",
    },
    (client) => client.listArtifacts(),
  );
  await expect(runApiRequest(request, new AbortController().signal)).rejects.toMatchObject({
    code,
  });
});
