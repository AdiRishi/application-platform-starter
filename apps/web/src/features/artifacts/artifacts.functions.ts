import { ArtifactId, ArtifactSummary } from "@repo/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callApiRpc, requestApiJson } from "@/server/api-client.server";

const decodeArtifactInput = Schema.decodeUnknownSync(Schema.Struct({ artifactId: ArtifactId }));
const decodeUploadInput = Schema.decodeUnknownSync(
  Schema.fromFormData(Schema.Struct({ file: Schema.File })),
);

export const listArtifacts = createServerFn({ method: "GET" }).handler(() =>
  callApiRpc((client) => client.listArtifacts()),
);

export const getArtifact = createServerFn({ method: "GET" })
  .validator((input: { readonly artifactId: string }) => decodeArtifactInput(input))
  .handler(({ data }) => callApiRpc((client) => client.getArtifact(data)));

export const uploadArtifact = createServerFn({ method: "POST" })
  .validator((input: FormData) => decodeUploadInput(input))
  .handler(({ data }) => {
    const form = new FormData();
    form.set("file", data.file);
    return requestApiJson({
      init: { body: form, method: "POST" },
      path: "/api/artifacts",
      schema: ArtifactSummary,
    });
  });
