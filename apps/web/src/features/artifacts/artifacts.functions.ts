import { ArtifactId } from "@repo/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { getArtifactFromApi, listArtifactsFromApi, uploadArtifactToApi } from "./artifacts.server";

const decodeArtifactInput = Schema.decodeUnknownSync(Schema.Struct({ artifactId: ArtifactId }));
const decodeUploadInput = Schema.decodeUnknownSync(
  Schema.fromFormData(Schema.Struct({ file: Schema.File })),
);

export const listArtifacts = createServerFn({ method: "GET" }).handler(() =>
  listArtifactsFromApi(),
);

export const getArtifact = createServerFn({ method: "GET" })
  .validator((input: { readonly artifactId: string }) => decodeArtifactInput(input))
  .handler(({ data }) => getArtifactFromApi(data.artifactId));

export const uploadArtifact = createServerFn({ method: "POST" })
  .validator((input: FormData) => decodeUploadInput(input))
  .handler(({ data }) => uploadArtifactToApi(data.file));
