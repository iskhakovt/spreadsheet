import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";
import { getCookie } from "hono/cookie";
import type { Logger } from "pino";
import type { HonoLoggerEnv } from "../logger.js";
import type { GroupStore } from "../store/groups.js";
import type { QuestionStore } from "../store/questions.js";
import type { SyncStore } from "../store/sync.js";

export interface TrpcContext {
  [key: string]: unknown;
  groups: GroupStore;
  sync: SyncStore;
  questions: QuestionStore;
  person: {
    id: string;
    groupId: string;
    name: string;
    anatomy: string | null;
    isAdmin: boolean;
    isCompleted: boolean;
  } | null;
  group: {
    id: string;
    encrypted: boolean;
    isReady: boolean;
    questionMode: string;
    anatomyLabels: string | null;
    anatomyPicker: string | null;
  } | null;
  /** Raw person token (or admin token) for paths that need to re-call token-based stores. */
  personToken: string | null;
  logger: Logger;
}

type Stores = { groups: GroupStore; sync: SyncStore; questions: QuestionStore };

async function buildContext(stores: Stores, token: string | null, log: Logger): Promise<TrpcContext> {
  if (!token) {
    return { ...stores, person: null, group: null, personToken: null, logger: log };
  }

  const person = await stores.groups.getPersonByToken(token);
  if (!person) {
    // Token might be an admin token (pre-setup, before setupAdmin creates the
    // person record). Public procedures like `groups.status` and the
    // `groups.onStatus` subscription handle admin tokens themselves.
    return { ...stores, person: null, group: null, personToken: token, logger: log };
  }

  const group = await stores.groups.getGroupById(person.groupId);
  return {
    ...stores,
    person,
    group,
    personToken: token,
    logger: log.child({ personId: person.id, groupId: person.groupId }),
  };
}

export async function createContext(
  stores: Stores,
  opts: FetchCreateContextFnOptions,
  c: HonoContext<HonoLoggerEnv>,
): Promise<TrpcContext> {
  // Auth: client sends the fnv1a(token) hash, server reads cookie `s_$hash`
  // to recover the actual token. The hash is non-secret — it's only used to
  // disambiguate which cookie to read so multi-person devices can coexist
  // (each person has their own `s_*` cookie).
  //
  // Two transport-shaped paths reach this function:
  //   • Queries/mutations send the hash via the `X-Session-Key` HTTP header.
  //   • Subscriptions (SSE via `httpSubscriptionLink`) send it via tRPC
  //     `connectionParams`, which arrive on `opts.info.connectionParams`.
  //
  // Cookies travel automatically on both transports (same-origin EventSource
  // sends them like any fetch), so the token-resolution step is identical.
  const cp = opts.info?.connectionParams as Record<string, unknown> | undefined;
  const sessionKey =
    (typeof cp?.sessionKey === "string" ? cp.sessionKey : null) ?? c.req.header("x-session-key") ?? null;
  const token = sessionKey ? (getCookie(c, `s_${sessionKey}`) ?? null) : null;
  return buildContext(stores, token, c.var.logger);
}
