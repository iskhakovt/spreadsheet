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
}

export async function createContext(
  stores: { groups: GroupStore; sync: SyncStore; questions: QuestionStore },
  c: HonoContext,
): Promise<TrpcContext> {
  const token = c.req.header("x-person-token");
  if (!token) {
    return { ...stores, person: null, group: null };
  }

  const person = await stores.groups.getPersonByToken(token);
  if (!person) {
    return { ...stores, person: null, group: null };
  }

  const group = await stores.groups.getGroupById(person.groupId);
  return { ...stores, person, group };
}
