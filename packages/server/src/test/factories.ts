import type { Database } from "../db/index.js";
import { groups, persons } from "../db/schema.js";
import { silentLogger } from "../logger.js";
import { GroupStore } from "../store/groups.js";
import { QuestionStore } from "../store/questions.js";
import { SyncStore } from "../store/sync.js";
import type { TrpcContext } from "../trpc/context.js";
import { createCallerFactory } from "../trpc/init.js";
import { appRouter } from "../trpc/router.js";

export const createCaller = createCallerFactory(appRouter);

function makeStores(db: Database) {
  return {
    groups: new GroupStore(db),
    sync: new SyncStore(db),
    questions: new QuestionStore(db),
  };
}

export function anonCtx(db: Database): TrpcContext {
  return { ...makeStores(db), person: null, group: null, personToken: null, logger: silentLogger } as TrpcContext;
}

/** Build an authenticated context from a status response. Single place for the cast. */
export function authedCtx(
  db: Database,
  status: { person: unknown; group: unknown },
  personToken: string | null = null,
): TrpcContext {
  return {
    ...makeStores(db),
    person: status.person,
    group: status.group,
    personToken,
    logger: silentLogger,
  } as TrpcContext;
}

export function defaultCreate(overrides: Record<string, unknown> = {}) {
  return {
    encrypted: false,
    questionMode: "all" as const,
    showTiming: true,
    anatomyLabels: null,
    anatomyPicker: null,
    ...overrides,
  };
}

/** Create group + admin person via API (setupAdmin), group IS ready */
export async function createAndSetup(db: Database, overrides: Record<string, unknown> = {}) {
  const caller = createCaller(anonCtx(db));
  const { adminToken } = await caller.groups.create(defaultCreate(overrides));
  await caller.groups.setupAdmin({
    adminToken,
    name: "Alice",
    anatomy: null,
    partners: [],
  });
  const status = await caller.groups.status({ token: adminToken });
  return {
    token: adminToken,
    status: status!,
    ctx: authedCtx(db, status!, adminToken),
  };
}

/** Direct DB insert — group NOT ready, for testing addPerson/removePerson */
export async function createGroupDirect(db: Database, overrides: Record<string, unknown> = {}) {
  const [group] = await db
    .insert(groups)
    .values({
      encrypted: false,
      isReady: false,
      questionMode: "all" as const,
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
      ...overrides,
    })
    .returning();

  const token = `test-${Math.random()}`;
  const [person] = await db
    .insert(persons)
    .values({
      groupId: group.id,
      name: "Alice",
      anatomy: null,
      token,
      isAdmin: true,
      isCompleted: false,
    })
    .returning();

  return { token, groupId: group.id, personId: person.id, ctx: authedCtx(db, { person, group }, token) };
}
