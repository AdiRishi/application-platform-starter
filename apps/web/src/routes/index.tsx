import { createFileRoute } from "@tanstack/react-router";

import { CsvProfilerPage } from "@/components/csv-profiler-page";
import {
  artifactQueryOptions,
  artifactsQueryOptions,
} from "@/features/artifacts/artifacts.queries";

export const Route = createFileRoute("/")({
  component: App,
  loader: async ({ context }) => {
    const artifacts = await context.queryClient.ensureQueryData(artifactsQueryOptions());
    const firstArtifact = artifacts[0];
    if (firstArtifact !== undefined) {
      await context.queryClient.ensureQueryData(artifactQueryOptions(firstArtifact.id));
    }
  },
});

function App() {
  return <CsvProfilerPage />;
}
