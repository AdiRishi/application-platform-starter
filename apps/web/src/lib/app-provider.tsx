import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

export function AppProviders({
  children,
  queryClient,
}: {
  readonly children: React.ReactNode;
  readonly queryClient: QueryClient;
}) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
