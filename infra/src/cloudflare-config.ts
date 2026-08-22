export const workerCompatibility = {
  date: "2026-08-22",
  flags: ["nodejs_compat"] satisfies Array<"nodejs_compat">,
};

export const workerObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
  traces: { enabled: true, headSamplingRate: 0.01 },
} as const;

export const bucketLifecycleRules = [
  {
    id: "abort-incomplete-uploads",
    enabled: true,
    prefix: "",
    abortMultipartUploadsTransition: {
      condition: { type: "Age", maxAge: 7 * 24 * 60 * 60 },
    },
  },
] as const;
