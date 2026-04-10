import type { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import type { Context as HonoContext } from "hono";
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
}

type Stores = { groups: GroupStore; sync: SyncStore; questions: QuestionStore };

async function buildContext(stores: Stores, token: string | null): Promise<TrpcContext> {
  if (!token) {
    return { ...stores, person: null, group: null, personToken: null };
  }

  const person = await stores.groups.getPersonByToken(token);
  if (!person) {
    // Token might be an admin token (pre-setup, before setupAdmin creates the
    // person record). Public procedures like `groups.status` and the
    // `groups.onStatus` subscription handle admin tokens themselves.
    return { ...stores, person: null, group: null, personToken: token };
  }

  const group = await stores.groups.getGroupById(person.groupId);
  return { ...stores, person, group, personToken: token };
}

export async function createContext(stores: Stores, c: HonoContext): Promise<TrpcContext> {
  return buildContext(stores, c.req.header("x-person-token") ?? null);
}

export async function createWSContext(stores: Stores, opts: CreateWSSContextFnOptions): Promise<TrpcContext> {
  const params = opts.info.connectionParams as { token?: string } | undefined;
  return buildContext(stores, params?.token ?? null);
}
