import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { AppProviders } from "@/lib/app-provider";

import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 2_000 } },
  });
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    context: { queryClient },
    Wrap: ({ children }) => <AppProviders queryClient={queryClient}>{children}</AppProviders>,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
