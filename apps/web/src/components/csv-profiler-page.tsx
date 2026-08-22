import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ProfileDetail } from "@/components/profile-detail";
import { RecentProfiles } from "@/components/recent-profiles";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { UploadZone } from "@/components/upload-zone";
import { getArtifact, listArtifacts, uploadArtifact } from "@/lib/api";

const artifactsKey = ["artifacts"] as const;

export function CsvProfilerPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const artifacts = useQuery({
    queryKey: artifactsKey,
    queryFn: listArtifacts,
    refetchInterval: (query) =>
      query.state.data?.some(
        (artifact) => artifact.status === "queued" || artifact.status === "processing",
      )
        ? 1_000
        : false,
  });
  const activeId = selectedId ?? artifacts.data?.[0]?.id;
  const detail = useQuery({
    queryKey: ["artifact", activeId],
    queryFn: () => getArtifact(activeId ?? ""),
    enabled: activeId !== undefined,
    refetchInterval: (query) => {
      const artifact = query.state.data;
      return artifact?.status === "queued" || artifact?.status === "processing" ? 500 : false;
    },
  });
  const upload = useMutation({
    mutationFn: uploadArtifact,
    onSuccess: async (artifact) => {
      setSelectedId(artifact.id);
      await queryClient.invalidateQueries({ queryKey: artifactsKey });
    },
  });

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center px-5 sm:px-8">
          <span className="text-base font-semibold tracking-tight">CSV Profile</span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
        <section className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Inspect a CSV</h1>
          <p className="text-base text-muted-foreground">
            Upload a CSV to inspect its shape, quality, and inferred column types.
          </p>
        </section>

        <UploadZone isUploading={upload.isPending} onUpload={(file) => upload.mutate(file)} />

        {upload.error ? (
          <Alert variant="destructive">
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>{upload.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid min-w-0 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <RecentProfiles
            artifacts={artifacts.data ?? []}
            selectedId={activeId}
            onSelect={setSelectedId}
          />
          <ProfileDetail artifact={detail.data} />
        </div>
      </main>
    </>
  );
}
