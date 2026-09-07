import { createFileRoute } from "@tanstack/react-router";

import { CsvProfilerPage } from "@/features/artifacts/page";
import { artifactQueryOptions, artifactsQueryOptions } from "@/features/artifacts/queries";

export const Route = createFileRoute("/")({
  component: CsvProfilerPage,
  loader: async ({ context }) => {
    const artifacts = await context.queryClient.ensureQueryData(artifactsQueryOptions());
    const firstArtifact = artifacts[0];
    if (firstArtifact !== undefined) {
      await context.queryClient.ensureQueryData(artifactQueryOptions(firstArtifact.id));
    }
  },
});
