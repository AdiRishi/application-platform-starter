import { createFileRoute } from "@tanstack/react-router";

import { CsvProfilerPage } from "@/components/csv-profiler-page";

export const Route = createFileRoute("/")({ component: App });

function App() {
  return <CsvProfilerPage />;
}
