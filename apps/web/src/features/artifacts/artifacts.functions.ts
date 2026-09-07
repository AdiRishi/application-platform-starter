import { ArtifactId } from "@repo/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc } from "@/server/api-client.server";

const decodeArtifactInput = Schema.decodeUnknownSync(Schema.Struct({ artifactId: ArtifactId }));

export const listArtifacts = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listArtifacts()),
);

export const getArtifact = createServerFn({ method: "GET" })
  .validator((input: { readonly artifactId: string }) => decodeArtifactInput(input))
  .handler(({ data }) => callApiRpc((client) => client.getArtifact(data)));
