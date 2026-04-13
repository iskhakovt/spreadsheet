/**
 * Base class for errors that should never be retried by TanStack Query.
 * The query client checks `instanceof NonRetriableError` to skip retries —
 * see `query-client.ts`.
 */
export class NonRetriableError extends Error {}
