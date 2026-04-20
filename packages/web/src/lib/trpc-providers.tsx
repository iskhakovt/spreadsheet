import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { makeTrpcClient, TRPCProvider } from "./trpc.js";

// Dev-only devtools, dynamically imported so they don't ship in production.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((mod) => ({
        default: mod.ReactQueryDevtools,
      })),
    )
  : () => null;

/**
 * App-wide providers: TanStack QueryClient + tRPC context.
 *
 * Both clients are created inside `useState(() => ...)` for referential
 * stability across renders. A new `QueryClient` on every render would wipe
 * the cache; a new `trpcClient` would reset the WebSocket connection.
 */
export function AppProviders({ children, queryClient }: Readonly<{ children: ReactNode; queryClient: QueryClient }>) {
  const [trpcClient] = useState(() => makeTrpcClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
        {import.meta.env.DEV && (
          <Suspense fallback={null}>
            <ReactQueryDevtools initialIsOpen={false} />
          </Suspense>
        )}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
