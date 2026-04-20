import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Card } from "../components/Card.js";
import { handleError, RootErrorFallback } from "../components/ErrorFallback.js";
import { RouteReset } from "../lib/route-reset.js";
import { AppProviders } from "../lib/trpc-providers.js";

export interface RouterContext {
  queryClient: QueryClient;
}

function LoadingCard() {
  return (
    <Card>
      <div className="flex items-center justify-center pt-32">
        <p className="text-text-muted/60">Loading...</p>
      </div>
    </Card>
  );
}

function RootLayout() {
  const { queryClient } = Route.useRouteContext();

  return (
    <ErrorBoundary FallbackComponent={RootErrorFallback} onError={handleError}>
      <AppProviders queryClient={queryClient}>
        <Suspense fallback={<LoadingCard />}>
          <RouteReset />
          <Outlet />
        </Suspense>
      </AppProviders>
    </ErrorBoundary>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="flex items-center justify-center min-h-dvh">
      <p className="text-text-muted">Page not found</p>
    </div>
  ),
});
