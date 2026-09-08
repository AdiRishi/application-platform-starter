import { ArtifactNotFound } from "@repo/contracts/artifacts";
import { ApiRpcs } from "@repo/contracts/artifacts/api";
import { rpcWebHandler } from "@repo/contracts/server";
import { Effect } from "effect";

export const api = rpcWebHandler(
  ApiRpcs,
  ApiRpcs.toLayer({
    listArtifacts: () => Effect.succeed([]),
    getArtifact: ({ artifactId }) => Effect.fail(new ArtifactNotFound({ artifactId })),
  }),
);
