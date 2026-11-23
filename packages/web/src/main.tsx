import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound } from "./components/not-found.js";
import { isKeyArrival, isKeySwitch } from "./lib/crypto.js";
import { makeQueryClient } from "./lib/query-client.js";
import { routeTree } from "./routeTree.gen.js";
import "@fontsource-variable/lexend";
import "./index.css";

const queryClient = makeQueryClient();

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface HistoryState {
    create?: boolean;
  }
}

// One page = one key. A fragment-only change (a different #key=, or a key on
// a page that loaded without one) may not re-render the router, so catch it
// here and reload; the fresh page verifies the key from scratch.
window.addEventListener("hashchange", () => {
  if (isKeySwitch() || isKeyArrival()) window.location.reload();
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
