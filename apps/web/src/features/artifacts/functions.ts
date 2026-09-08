import { AppRequestError } from "@repo/contracts/app";
import { ArtifactId } from "@repo/contracts/artifacts";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

import { artifactRequestErrors } from "./errors";

const decodeArtifactInput = Schema.decodeUnknownResult(Schema.Struct({ artifactId: ArtifactId }));

export const listArtifacts = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) =>
    client
      .listArtifacts()
      .pipe(Effect.catchTag("ArtifactsUnavailable", artifactRequestErrors.ArtifactsUnavailable)),
  ),
);

export const getArtifact = createServerFn({ method: "GET" })
  .validator((input: { readonly artifactId: string }) => {
    const decoded = decodeArtifactInput(input);
    if (decoded._tag === "Failure")
      throw new AppRequestError("invalid_request", "The artifact id is invalid.");
    return decoded.success;
  })
  .handler(({ data }) =>
    callApiRpc((client) => client.getArtifact(data).pipe(Effect.catchTags(artifactRequestErrors))),
  );
