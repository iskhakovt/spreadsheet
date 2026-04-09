import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { getAuthToken } from "./session.js";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      headers() {
        const token = getAuthToken();
        return token ? { "x-person-token": token } : {};
      },
    }),
  ],
});
