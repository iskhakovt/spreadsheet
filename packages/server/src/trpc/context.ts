import { randomUUID } from "node:crypto";
import type { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import type { Context as HonoContext } from "hono";
import type { Logger } from "pino";
import { type HonoLoggerEnv, logger as rootLogger } from "../logger.js";
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
    showTiming: boolean;
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

  const person = await stores.groups.getPersonByAuthToken(token);
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

export async function createContext(stores: Stores, c: HonoContext<HonoLoggerEnv>): Promise<TrpcContext> {
  return buildContext(stores, c.req.header("x-person-token") ?? null, c.var.logger);
}

export async function createWSContext(stores: Stores, opts: CreateWSSContextFnOptions): Promise<TrpcContext> {
  const params = opts.info.connectionParams as { token?: string } | undefined;
  // `connId` is per-WS-connection (analogous to `reqId` for HTTP) — without it,
  // log lines from concurrent WS subscriptions can't be correlated.
  const connLogger = rootLogger.child({ transport: "ws", connId: randomUUID() });
  return buildContext(stores, params?.token ?? null, connLogger);
}
